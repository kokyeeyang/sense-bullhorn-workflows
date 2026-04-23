require("dotenv").config();

const { loadConfig } = require("./config");
const { logger } = require("./logger");
const { BullhornClient } = require("./bullhornClient");
const { epochSecondsFromDateString } = require("./clientCorporation360Sync");
const {
  buildDoNotContactPatch,
  getContactChanges,
  inferCurrentClientCorporationContactPatch,
  inferEventDrivenContactPatch,
  inferNewContactDoNotContactPatch,
  isBlockedContactName,
  isClientCorporationDoNotContact,
  isClientCorporationStatusDoNotContactActivation,
  isClientCorporationStatusReactivation,
  isContactDoNotContact,
} = require("./clientContactDncSyncUtils");
const { buildWorkflowResult, serializeError, writeJsonArtifact } = require("./workflowRuntime");

const SKIPPED_CONTACTS_PREVIEW_LIMIT = 25;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function writeChangesReport({ report }) {
  return writeJsonArtifact({ filePrefix: "client-contact-dnc-report", payload: report });
}

function buildAffectedContactRecord({ contact, clientCorporationId, patchType, mode, source, changes }) {
  return {
    clientContactId: contact.id,
    clientCorporationId: clientCorporationId || contact?.clientCorporation?.id || null,
    mode,
    source,
    patchType,
    contact: {
      name: contact?.name || null,
      firstName: contact?.firstName || null,
      lastName: contact?.lastName || null,
      dateAdded: contact?.dateAdded || null,
      status: contact?.status ?? null,
      massMailOptOut: contact?.massMailOptOut ?? null,
    },
    clientCorporation: {
      id: contact?.clientCorporation?.id || clientCorporationId || null,
      name: contact?.clientCorporation?.name || null,
      status: contact?.clientCorporation?.status ?? null,
    },
    changes,
  };
}

function buildSkippedContactRecord({ contact, reason, source }) {
  return {
    clientContactId: contact?.id || null,
    source,
    reason,
    contact: {
      name: contact?.name || null,
      firstName: contact?.firstName || null,
      lastName: contact?.lastName || null,
      dateAdded: contact?.dateAdded || null,
      status: contact?.status ?? null,
      massMailOptOut: contact?.massMailOptOut ?? null,
    },
    clientCorporation: {
      id: contact?.clientCorporation?.id || null,
      name: contact?.clientCorporation?.name || null,
      status: contact?.clientCorporation?.status ?? null,
    },
  };
}

function buildDedupKey(contactId, patch) {
  return `${contactId}:${patch.status}:${patch.massMailOptOut}`;
}

function elapsedMs(startTime) {
  return Date.now() - startTime;
}

function buildDelayedScanWindow({ fromEpoch, delayHours, scanWindowHours, now = Date.now() }) {
  const windowEndEpochSeconds = Math.floor((now - delayHours * 60 * 60 * 1000) / 1000);
  const rawWindowStartEpochSeconds = Math.floor(
    (now - (delayHours + scanWindowHours) * 60 * 60 * 1000) / 1000,
  );

  return {
    fromEpochSeconds: Math.max(fromEpoch, rawWindowStartEpochSeconds),
    toEpochSeconds: windowEndEpochSeconds,
    delayHours,
    scanWindowHours,
  };
}

async function loadContactsForDelayedScan({ bullhorn, session, config, fromEpoch, delayedScanWindow }) {
  if (config.TEST_CLIENT_CONTACT_ID) {
    return bullhorn.searchClientContacts({
      restUrl: session.restUrl,
      bhRestToken: session.bhRestToken,
      fromEpochSeconds: fromEpoch,
      toEpochSeconds: null,
      clientContactId: config.TEST_CLIENT_CONTACT_ID,
    });
  }

  if (config.TEST_CLIENT_CORPORATION_ID) {
    return bullhorn.getClientCorporationContacts({
      restUrl: session.restUrl,
      bhRestToken: session.bhRestToken,
      clientCorporationId: config.TEST_CLIENT_CORPORATION_ID,
      count: config.CLIENT_CONTACT_DNC_QUERY_COUNT,
    });
  }

  return bullhorn.searchClientContacts({
    restUrl: session.restUrl,
    bhRestToken: session.bhRestToken,
    fromEpochSeconds: delayedScanWindow.fromEpochSeconds,
    toEpochSeconds: delayedScanWindow.toEpochSeconds,
    clientContactId: null,
    excludeStatus: null,
  });
}

async function run() {
  const startedAtMs = Date.now();
  const config = loadConfig();
  const bullhorn = new BullhornClient({ config, logger });
  const fromEpoch = epochSecondsFromDateString(config.CLIENT_CONTACT_DNC_CUTOFF_DATE);
  const delayedScanWindow = buildDelayedScanWindow({
    fromEpoch,
    delayHours: config.CLIENT_CONTACT_DNC_DELAY_HOURS,
    scanWindowHours: config.CLIENT_CONTACT_DNC_SCAN_WINDOW_HOURS,
  });

  logger.info(
    {
      cutoffDate: config.CLIENT_CONTACT_DNC_CUTOFF_DATE,
      delayHours: config.CLIENT_CONTACT_DNC_DELAY_HOURS,
      scanWindowHours: config.CLIENT_CONTACT_DNC_SCAN_WINDOW_HOURS,
      delayedScanFromEpoch: delayedScanWindow.fromEpochSeconds,
      delayedScanToEpoch: delayedScanWindow.toEpochSeconds,
      eventSubscriptionId: config.CLIENT_CONTACT_DNC_EVENT_SUBSCRIPTION_ID,
      eventMaxEvents: config.CLIENT_CONTACT_DNC_EVENT_MAX_EVENTS,
      dryRun: config.DRY_RUN,
      testClientCorporationId: config.TEST_CLIENT_CORPORATION_ID || null,
      testClientContactId: config.TEST_CLIENT_CONTACT_ID || null,
      retryMaxAttempts: config.RETRY_MAX_ATTEMPTS,
      retryBaseDelayMs: config.RETRY_BASE_DELAY_MS,
      updateDelayMs: config.UPDATE_DELAY_MS,
    },
    "Starting client contact DNC sync",
  );

  logger.info({ elapsedMs: elapsedMs(startedAtMs) }, "Starting Bullhorn authorization");
  const code = await bullhorn.getAuthorizationCode();
  logger.info({ elapsedMs: elapsedMs(startedAtMs) }, "Bullhorn authorization code acquired");
  const accessToken = await bullhorn.getAccessToken(code);
  logger.info({ elapsedMs: elapsedMs(startedAtMs) }, "Bullhorn access token acquired");
  const session = await bullhorn.login(accessToken);
  logger.info({ elapsedMs: elapsedMs(startedAtMs), restUrl: session.restUrl }, "Bullhorn login completed");

  logger.info({ elapsedMs: elapsedMs(startedAtMs) }, "Ensuring client corporation event subscription");
  await bullhorn.upsertEventSubscription({
    restUrl: session.restUrl,
    bhRestToken: session.bhRestToken,
    subscriptionId: config.CLIENT_CONTACT_DNC_EVENT_SUBSCRIPTION_ID,
    entityName: "ClientCorporation",
  });

  logger.info({ elapsedMs: elapsedMs(startedAtMs) }, "Consuming client corporation events");
  const eventResponse = await bullhorn.consumeEvents({
    restUrl: session.restUrl,
    bhRestToken: session.bhRestToken,
    subscriptionId: config.CLIENT_CONTACT_DNC_EVENT_SUBSCRIPTION_ID,
    maxEvents: config.CLIENT_CONTACT_DNC_EVENT_MAX_EVENTS,
  });

  const events = eventResponse.events || [];
  logger.info(
    {
      elapsedMs: elapsedMs(startedAtMs),
      eventCount: events.length,
    },
    "Finished consuming client corporation events",
  );

  logger.info(
    {
      elapsedMs: elapsedMs(startedAtMs),
      mode: config.TEST_CLIENT_CONTACT_ID
        ? "test-client-contact"
        : config.TEST_CLIENT_CORPORATION_ID
          ? "test-client-corporation"
          : "rolling-delay-window-search",
      cutoffDate: config.CLIENT_CONTACT_DNC_CUTOFF_DATE,
      delayedScanFromEpoch: delayedScanWindow.fromEpochSeconds,
      delayedScanToEpoch: delayedScanWindow.toEpochSeconds,
      testClientCorporationId: config.TEST_CLIENT_CORPORATION_ID || null,
      testClientContactId: config.TEST_CLIENT_CONTACT_ID || null,
    },
    "Starting delayed-scan contact load",
  );
  const newContacts = await loadContactsForDelayedScan({
    bullhorn,
    session,
    config,
    fromEpoch,
    delayedScanWindow,
  });
  logger.info(
    {
      elapsedMs: elapsedMs(startedAtMs),
      clientContactCount: newContacts.length,
    },
    "Finished delayed-scan contact load",
  );

  logger.info(
    {
      clientContactCount: newContacts.length,
      eventCount: events.length,
    },
    "Fetched contacts and client corporation events for DNC sync",
  );

  let updated = 0;
  let skippedDelayNotMet = 0;
  let skippedBlockedName = 0;
  let skippedClientNotDoNotContact = 0;
  let skippedContactAlreadyDoNotContact = 0;
  let skippedNoStatusEventChange = 0;
  let skippedWrongTransition = 0;
  let skippedDuplicateContact = 0;
  let skippedNoChange = 0;
  const matchedEventsByClientCorporationId = new Map();
  const affectedContacts = [];
  const skippedContacts = [];
  const skippedTransitions = [];
  const processedContactTargets = new Set();

  for (const contact of newContacts) {
    let patch = inferCurrentClientCorporationContactPatch(contact);
    if (
      patch?.status === buildDoNotContactPatch().status &&
      !inferNewContactDoNotContactPatch(contact, {
        delayHours: config.CLIENT_CONTACT_DNC_DELAY_HOURS,
      })
    ) {
      patch = null;
    }

    if (!patch) {
      if (
        !isClientCorporationDoNotContact(contact?.clientCorporation) &&
        !isContactDoNotContact(contact)
      ) {
        skippedClientNotDoNotContact += 1;
        if (skippedContacts.length < SKIPPED_CONTACTS_PREVIEW_LIMIT) {
          skippedContacts.push(
            buildSkippedContactRecord({
              contact,
              reason: "client-corporation-not-do-not-contact",
              source: "new-contact-delay-scan",
            }),
          );
        }
      } else if (
        isClientCorporationDoNotContact(contact?.clientCorporation) &&
        isContactDoNotContact(contact)
      ) {
        skippedContactAlreadyDoNotContact += 1;
        if (skippedContacts.length < SKIPPED_CONTACTS_PREVIEW_LIMIT) {
          skippedContacts.push(
            buildSkippedContactRecord({
              contact,
              reason: "contact-already-do-not-contact",
              source: "new-contact-delay-scan",
            }),
          );
        }
      } else if (isBlockedContactName(contact)) {
        skippedBlockedName += 1;
        if (skippedContacts.length < SKIPPED_CONTACTS_PREVIEW_LIMIT) {
          skippedContacts.push(
            buildSkippedContactRecord({
              contact,
              reason: "blocked-contact-name-prefix",
              source: "new-contact-delay-scan",
            }),
          );
        }
      } else {
        skippedDelayNotMet += 1;
        if (skippedContacts.length < SKIPPED_CONTACTS_PREVIEW_LIMIT) {
          skippedContacts.push(
            buildSkippedContactRecord({
              contact,
              reason: "delay-not-met",
              source: "new-contact-delay-scan",
            }),
          );
        }
      }
      continue;
    }

    const dedupKey = buildDedupKey(contact.id, patch);
    if (processedContactTargets.has(dedupKey)) {
      skippedDuplicateContact += 1;
      continue;
    }

    const changes = getContactChanges(contact, patch);
    if (changes.length === 0) {
      skippedNoChange += 1;
      continue;
    }

    processedContactTargets.add(dedupKey);
    const patchType = patch.status === "Active" ? "set-active" : "set-do-not-contact";

    if (config.DRY_RUN) {
      affectedContacts.push(
        buildAffectedContactRecord({
          contact,
          patchType,
          mode: "dry-run",
          source: "new-contact-delay-scan",
          changes,
        }),
      );
      updated += 1;
      continue;
    }

    await bullhorn.updateClientContact({
      restUrl: session.restUrl,
      bhRestToken: session.bhRestToken,
      clientContactId: contact.id,
      patch,
    });

    affectedContacts.push(
      buildAffectedContactRecord({
        contact,
        patchType,
        mode: "updated",
        source: "new-contact-delay-scan",
        changes,
      }),
    );
    updated += 1;

    if (config.UPDATE_DELAY_MS > 0) {
      await sleep(config.UPDATE_DELAY_MS);
    }
  }

  for (const event of events) {
    const updatedProperties = event.updatedProperties || [];
    if (!updatedProperties.includes("status")) {
      skippedNoStatusEventChange += 1;
      continue;
    }

    const clientCorporationId = Number(event.entityId || 0);
    const transactionId = event.entityEvent?.transactionID || event.transactionID || null;
    if (!clientCorporationId) {
      skippedWrongTransition += 1;
      skippedTransitions.push({
        clientCorporationId: null,
        transactionId,
        oldValue: null,
        newValue: null,
        reason: "missing-client-corporation-id",
      });
      continue;
    }

    if (
      config.TEST_CLIENT_CORPORATION_ID &&
      clientCorporationId !== config.TEST_CLIENT_CORPORATION_ID
    ) {
      continue;
    }

    if (!transactionId) {
      matchedEventsByClientCorporationId.set(clientCorporationId, {
        clientCorporationId,
        transactionId: null,
        statusChange: null,
        useCurrentClientCorporationStatus: true,
      });
      continue;
    }

    const statusChange = await bullhorn.getClientCorporationStatusChange({
      restUrl: session.restUrl,
      bhRestToken: session.bhRestToken,
      transactionId,
    });

    const isMatchedTransition =
      isClientCorporationStatusReactivation(statusChange) ||
      isClientCorporationStatusDoNotContactActivation(statusChange);

    if (!isMatchedTransition) {
      skippedWrongTransition += 1;
      skippedTransitions.push({
        clientCorporationId,
        transactionId,
        oldValue: statusChange?.oldValue ?? null,
        newValue: statusChange?.newValue ?? null,
      });
      continue;
    }

    matchedEventsByClientCorporationId.set(clientCorporationId, {
      clientCorporationId,
      transactionId,
      statusChange,
    });
  }

  for (const matchedEvent of matchedEventsByClientCorporationId.values()) {
    const contacts = await bullhorn.getClientCorporationContacts({
      restUrl: session.restUrl,
      bhRestToken: session.bhRestToken,
      clientCorporationId: matchedEvent.clientCorporationId,
      count: config.CLIENT_CONTACT_DNC_QUERY_COUNT,
    });

    for (const contact of contacts) {
      const patch = matchedEvent.useCurrentClientCorporationStatus
        ? inferCurrentClientCorporationContactPatch(contact)
        : inferEventDrivenContactPatch({
            statusChange: matchedEvent.statusChange,
            contact,
          });

      if (!patch) {
        continue;
      }

      const dedupKey = buildDedupKey(contact.id, patch);
      if (processedContactTargets.has(dedupKey)) {
        skippedDuplicateContact += 1;
        continue;
      }

      const changes = getContactChanges(contact, patch);
      if (changes.length === 0) {
        skippedNoChange += 1;
        continue;
      }

      processedContactTargets.add(dedupKey);
      const patchType =
        patch.status === "Active" ? "set-active" : "set-do-not-contact";

      if (config.DRY_RUN) {
        affectedContacts.push(
          buildAffectedContactRecord({
            contact,
            clientCorporationId: matchedEvent.clientCorporationId,
            patchType,
            mode: "dry-run",
            source: "client-corporation-status-event",
            changes,
          }),
        );
        updated += 1;
        continue;
      }

      await bullhorn.updateClientContact({
        restUrl: session.restUrl,
        bhRestToken: session.bhRestToken,
        clientContactId: contact.id,
        patch,
      });

      affectedContacts.push(
        buildAffectedContactRecord({
          contact,
          clientCorporationId: matchedEvent.clientCorporationId,
          patchType,
          mode: "updated",
          source: "client-corporation-status-event",
          changes,
        }),
      );
      updated += 1;

      if (config.UPDATE_DELAY_MS > 0) {
        await sleep(config.UPDATE_DELAY_MS);
      }
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    dryRun: config.DRY_RUN,
    testClientCorporationId: config.TEST_CLIENT_CORPORATION_ID || null,
    testClientContactId: config.TEST_CLIENT_CONTACT_ID || null,
    window: {
      cutoffDate: config.CLIENT_CONTACT_DNC_CUTOFF_DATE,
      delayHours: config.CLIENT_CONTACT_DNC_DELAY_HOURS,
      scanWindowHours: config.CLIENT_CONTACT_DNC_SCAN_WINDOW_HOURS,
      cutoffDateEpochSeconds: fromEpoch,
      eligibleContactDateAddedFromEpochSeconds: delayedScanWindow.fromEpochSeconds,
      eligibleContactDateAddedToEpochSeconds: delayedScanWindow.toEpochSeconds,
    },
    totals: {
      totalContactsScanned: newContacts.length,
      totalEvents: events.length,
      matchedClientCorporationTransitions: matchedEventsByClientCorporationId.size,
      affectedContacts: affectedContacts.length,
      updated,
      skippedDelayNotMet,
      skippedBlockedName,
      skippedClientNotDoNotContact,
      skippedContactAlreadyDoNotContact,
      skippedNoStatusEventChange,
      skippedWrongTransition,
      skippedDuplicateContact,
      skippedNoChange,
    },
    skippedContacts,
    skippedTransitions,
    affectedContacts,
  };

  const reportPath = await writeChangesReport({ report });
  logger.info({ reportPath }, "Client contact DNC report written");

  return buildWorkflowResult({
    workflowName: "client-contact-dnc-sync",
    report,
    artifacts: {
      reportPath,
    },
  });
}

if (require.main === module) {
  run().catch((error) => {
    logger.error(serializeError(error), "Client contact DNC sync failed");
    process.exitCode = 1;
  });
}

module.exports = { buildAffectedContactRecord, buildDelayedScanWindow, run };
