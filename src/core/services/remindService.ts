export function buildPaymentReminderMessage(params: {
  customerGroupName: string;
  customerName: string;
  customerUserId?: string | number | null;
  totalDueAmount: number | string;
}): string {
  const formattedAmount = Number(params.totalDueAmount || 0).toFixed(2);
  const groupName = params.customerGroupName || 'Customer Group';
  const custName = params.customerName || 'Customer';
  const userTag = params.customerUserId
    ? `<a href="tg://user?id=${params.customerUserId}">${custName}</a>`
    : `<b>${custName}</b>`;

  return (
`🔔 <b>Payment Balance Reminder</b>
<b>${groupName}</b>
Hello ${userTag},

You currently have pending orders with an outstanding balance:

━━━━━━━━━━━━━━━━━━━━━
💰 <b>Total Due:</b> <code>${formattedAmount} USDT</code>
━━━━━━━━━━━━━━━━━━━━━

Please settle your balance and drop the receipt screenshot here. Thank you!`
  );
}
