// =========================================================================
// CivicSays — realtime.js
// Thin wrappers around Supabase Realtime channels. Each helper returns
// a teardown function that unsubscribes the channel.
// =========================================================================

import { getClient, T } from './supabase.js';

/**
 * Subscribe to a single ticket's changes. Fires `onChange(payload)` on any
 * INSERT/UPDATE/DELETE on the row.
 *
 * @param {string} ticketId
 * @param {(payload: {eventType: string, new: any, old: any}) => void} onChange
 * @returns {() => void}  unsubscribe
 */
export function subscribeTicket(ticketId, onChange) {
  let channel = null;
  let cancelled = false;

  (async () => {
    const c = await getClient();
    if (cancelled) return;
    channel = c
      .channel('ticket:' + ticketId)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: T.TICKETS, filter: 'id=eq.' + ticketId },
        (payload) => onChange(payload)
      )
      .subscribe();
  })();

  return () => {
    cancelled = true;
    if (channel) {
      channel.unsubscribe();
    }
  };
}

/**
 * Subscribe to comments on a ticket. Fires on any change to ticket_comments
 * where ticket_id matches.
 *
 * @param {string} ticketId
 * @param {(payload: any) => void} onChange
 * @returns {() => void}
 */
export function subscribeTicketComments(ticketId, onChange) {
  let channel = null;
  let cancelled = false;

  (async () => {
    const c = await getClient();
    if (cancelled) return;
    channel = c
      .channel('ticket_comments:' + ticketId)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: T.TICKET_COMMENTS, filter: 'ticket_id=eq.' + ticketId },
        (payload) => onChange(payload)
      )
      .subscribe();
  })();

  return () => {
    cancelled = true;
    if (channel) channel.unsubscribe();
  };
}

/**
 * Subscribe to the inquiries list (used on admin dashboard). Fires on any
 * change to the inquiries table.
 *
 * @param {(payload: any) => void} onChange
 * @returns {() => void}
 */
export function subscribeInquiries(onChange) {
  let channel = null;
  let cancelled = false;

  (async () => {
    const c = await getClient();
    if (cancelled) return;
    channel = c
      .channel('inquiries:all')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: T.INQUIRIES },
        (payload) => onChange(payload)
      )
      .subscribe();
  })();

  return () => {
    cancelled = true;
    if (channel) channel.unsubscribe();
  };
}

/**
 * Subscribe to a single inquiry's changes (resident waiting screen +
 * active chat). Fires on any UPDATE — typically the status change from
 * waiting → active.
 *
 * @param {string} inquiryId
 * @param {(payload: any) => void} onChange
 * @returns {() => void}
 */
export function subscribeInquiry(inquiryId, onChange) {
  let channel = null;
  let cancelled = false;

  (async () => {
    const c = await getClient();
    if (cancelled) return;
    channel = c
      .channel('inquiry:' + inquiryId)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: T.INQUIRIES, filter: 'id=eq.' + inquiryId },
        (payload) => onChange(payload)
      )
      .subscribe();
  })();

  return () => {
    cancelled = true;
    if (channel) channel.unsubscribe();
  };
}

/**
 * Subscribe to messages in an inquiry. Fires on INSERT.
 *
 * @param {string} inquiryId
 * @param {(payload: any) => void} onChange
 * @returns {() => void}
 */
export function subscribeInquiryMessages(inquiryId, onChange) {
  let channel = null;
  let cancelled = false;

  (async () => {
    const c = await getClient();
    if (cancelled) return;
    channel = c
      .channel('inquiry_messages:' + inquiryId)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: T.INQUIRY_MESSAGES, filter: 'inquiry_id=eq.' + inquiryId },
        (payload) => onChange(payload)
      )
      .subscribe();
  })();

  return () => {
    cancelled = true;
    if (channel) channel.unsubscribe();
  };
}

/**
 * Subscribe to status history changes for a ticket. Fires on any change to
 * ticket_status_history where ticket_id matches. Used by ticket.html to
 * live-update the history list when an official changes a ticket's status.
 *
 * @param {string} ticketId
 * @param {(payload: any) => void} onChange
 * @returns {() => void}
 */
export function subscribeTicketStatusHistory(ticketId, onChange) {
  let channel = null;
  let cancelled = false;

  (async () => {
    const c = await getClient();
    if (cancelled) return;
    channel = c
      .channel('ticket_status_history:' + ticketId)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: T.TICKET_STATUS_HISTORY, filter: 'ticket_id=eq.' + ticketId },
        (payload) => onChange(payload)
      )
      .subscribe();
  })();

  return () => {
    cancelled = true;
    if (channel) channel.unsubscribe();
  };
}
