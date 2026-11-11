/**
 * Default wording of the emails guests receive. Used by the seed script and as a fallback at send time,
 * so an email still goes out with this text if the template row hasn't been created in the database yet.
 * Edit the live copy from Email templates in the dashboard.
 *
 * Merge variables: {{first_name}}, {{full_name}}, {{email}}, {{phone}}, {{reserve_link}},
 * plus every Settings key, for example {{programme_name}}, {{event_date}}, {{event_time}}, {{event_venue}}.
 */
export interface DefaultTemplate {
  key: string;
  subject: string;
  replyTo: string;
  body: string;
}

export const DEFAULT_EMAIL_TEMPLATES: DefaultTemplate[] = [
  {
    key: "invitation",
    subject: "You're invited: {{programme_name}}",
    replyTo: "{{contact_email}}",
    body: `Hi {{first_name}},

It would be our pleasure to have you join us at the {{programme_name}}. This is a private gathering, strictly by invitation, and a seat is waiting for you.

Please confirm that you are coming by reserving your seat with the button below. It takes one click, and your entry ticket will be emailed to you straight away.

Please keep your ticket handy (on your phone or printed), because you will be asked to show it at the entrance.`,
  },
  {
    key: "reservation_reminder",
    subject: "Your seat for the {{programme_name}} is waiting",
    replyTo: "{{contact_email}}",
    body: `Hi {{first_name}},

A quick reminder that your invitation to the {{programme_name}} is still open, and we have not yet received your seat reservation.

Seats are limited and are confirmed in the order reservations come in, so please reserve yours with the button below.

If you are no longer able to join us, there is nothing you need to do.`,
  },
  {
    key: "test_invite",
    subject: "Welcome to {{programme_name}}",
    replyTo: "{{contact_email}}",
    body: `Welcome to {{programme_name}}, {{first_name}}. You made it.

We are glad you are here. When the team opens the test, use the button below to take it. This link is personal to you. Your details are already filled in, so you do not need to enter anything.

[button]

Once you start, a timer begins and your answers are saved as you go. If the test is not open yet, the page will tell you. Keep this email and come back to the same button.

To your growth,
Pertinence Team`,
  },
];

/** The templates that are edited from the dashboard (the other keys in the table belong to the switched-off modules). */
export const EDITABLE_TEMPLATE_KEYS = DEFAULT_EMAIL_TEMPLATES.map((t) => t.key);

export function defaultTemplate(key: string): DefaultTemplate | undefined {
  return DEFAULT_EMAIL_TEMPLATES.find((t) => t.key === key);
}
