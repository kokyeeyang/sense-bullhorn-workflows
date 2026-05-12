# Email Template Theme

Use this theme for SparkPost HTML templates in this folder.

## Base Layout

- Email background: `#f4f6f8`
- Card background: `#ffffff`
- Card width: `max-width:680px`
- Card border: `1px solid #d9dee7`
- Card radius: `8px`
- Body font: `Arial, Helvetica, sans-serif`
- Body text: `#202124`
- Muted text: `#5f6673` or `#6b7280`
- Link and primary action: `#5630d3`
- Formal notice header: `#2f3542`

## Standard Shell

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Email Title</title>
</head>
<body style="margin:0; padding:0; background-color:#f4f6f8; font-family:Arial, Helvetica, sans-serif; color:#202124;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f4f6f8; margin:0; padding:24px 0;">
    <tr>
      <td align="center" style="padding:0 12px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:680px; background-color:#ffffff; border:1px solid #d9dee7; border-radius:8px; overflow:hidden;">
          <tr>
            <td style="padding:30px 28px;">
              <p style="margin:0 0 18px; font-size:16px; line-height:24px;">Email content</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
```

## CTA Buttons

Primary actions should use `#5630d3` with white text. Secondary actions should use a white background, `#b8c0cc` border, and `#202124` text.

Use table-based buttons instead of relying only on CSS button styling, because these templates are sent through email clients.

## SparkPost Template Files

- `benefits-reminder-day-10.html`
- `benefits-reminder-day-21.html`
- `benefits-reminder-day-26.html`
- `harassment-training-onboarding-confirmation.html`
- `harassment-training-california-notice.html`
- `harassment-training-state-notice.html`
- `interview-illinois-alert.html`
- `placement-termination.html`
- `placement-start-reminder.html`
- `new-job-illinois-alert.html`
- `placement-yearly-fee-increase-reminder.html`

## Preview Data

Use `sparkpost-preview-substitution-data.json` for SparkPost preview substitution data. Copy the object for the template being previewed into SparkPost's substitution data field.
