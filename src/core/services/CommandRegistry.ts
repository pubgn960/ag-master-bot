export interface CommandDefinition {
  cmd: string;
  category: 'CUSTOMER' | 'TEAM' | 'OWNER_STAFF_UTILITY';
  desc: string;
  role: string;
  enabled: boolean;
  classification: 'FUNCTIONAL' | 'READ-ONLY' | 'DASHBOARD HANDOFF' | 'DISABLED' | 'NOT IMPLEMENTED';
  botFatherVisible: boolean;
}

export const COMMAND_REGISTRY: CommandDefinition[] = [
  { cmd: '/start', category: 'CUSTOMER', desc: 'Welcome message and bot instructions', role: 'Any User', enabled: true, classification: 'READ-ONLY', botFatherVisible: true },
  { cmd: '/help', category: 'CUSTOMER', desc: 'Display help menu', role: 'Any User', enabled: true, classification: 'READ-ONLY', botFatherVisible: true },
  { cmd: '/prices', category: 'CUSTOMER', desc: 'Show current bundle prices for the group', role: 'Any User', enabled: true, classification: 'READ-ONLY', botFatherVisible: true },
  { cmd: '/pay', category: 'CUSTOMER', desc: 'Show payment profile instructions and addresses', role: 'Any User', enabled: true, classification: 'READ-ONLY', botFatherVisible: true },
  { cmd: '/payment', category: 'CUSTOMER', desc: 'Alias for /pay', role: 'Any User', enabled: true, classification: 'READ-ONLY', botFatherVisible: false },
  { cmd: '/pay_pk', category: 'CUSTOMER', desc: 'Directly show Pakistan Local Bank & Wallet payment details', role: 'Any User', enabled: true, classification: 'READ-ONLY', botFatherVisible: false },
  { cmd: '/pay_pkr', category: 'CUSTOMER', desc: 'Alias for /pay_pk', role: 'Any User', enabled: true, classification: 'READ-ONLY', botFatherVisible: false },
  { cmd: '/pay_inr', category: 'CUSTOMER', desc: 'Directly show India UPI & Bank payment details', role: 'Any User', enabled: true, classification: 'READ-ONLY', botFatherVisible: false },
  { cmd: '/pay_crypto', category: 'CUSTOMER', desc: 'Directly show Crypto & Binance payment details', role: 'Any User', enabled: true, classification: 'READ-ONLY', botFatherVisible: false },
  { cmd: '/myorders', category: 'CUSTOMER', desc: 'Show order history for the user', role: 'Any User', enabled: true, classification: 'READ-ONLY', botFatherVisible: true },

  
  { cmd: '/calc', category: 'OWNER_STAFF_UTILITY', desc: 'Calculate math expression', role: 'Owner/Staff', enabled: true, classification: 'FUNCTIONAL', botFatherVisible: false },
  { cmd: '/total', category: 'OWNER_STAFF_UTILITY', desc: 'Show current session running total', role: 'Owner/Staff', enabled: true, classification: 'READ-ONLY', botFatherVisible: false },
  { cmd: '/undo', category: 'OWNER_STAFF_UTILITY', desc: 'Undo last calculation step', role: 'Owner/Staff', enabled: true, classification: 'FUNCTIONAL', botFatherVisible: false },
  { cmd: '/clearcalc', category: 'OWNER_STAFF_UTILITY', desc: 'Clear running total', role: 'Owner/Staff', enabled: true, classification: 'FUNCTIONAL', botFatherVisible: false },
  { cmd: '/reset', category: 'OWNER_STAFF_UTILITY', desc: 'Reset calculator session', role: 'Owner/Staff', enabled: true, classification: 'FUNCTIONAL', botFatherVisible: false },
  { cmd: '/id', category: 'OWNER_STAFF_UTILITY', desc: 'Show Telegram ID', role: 'Owner/Staff', enabled: true, classification: 'READ-ONLY', botFatherVisible: false },
  { cmd: '/whoami', category: 'OWNER_STAFF_UTILITY', desc: 'Show user profile information', role: 'Owner/Staff', enabled: true, classification: 'READ-ONLY', botFatherVisible: false },
  
  { cmd: '/pending', category: 'TEAM', desc: 'List pending orders awaiting verification', role: 'Staff', enabled: true, classification: 'READ-ONLY', botFatherVisible: false },
  { cmd: '/stats', category: 'TEAM', desc: 'Show daily sales statistics', role: 'Owner', enabled: true, classification: 'READ-ONLY', botFatherVisible: false },
  { cmd: '/groups', category: 'TEAM', desc: 'List all registered Telegram groups', role: 'Staff', enabled: true, classification: 'READ-ONLY', botFatherVisible: false },
  
  { cmd: '/sendpaydetails', category: 'TEAM', desc: 'Send assigned payment details to all customer groups', role: 'Staff', enabled: true, classification: 'FUNCTIONAL', botFatherVisible: false },
  { cmd: '/setprice', category: 'TEAM', desc: 'Override selling price for a bundle', role: 'Owner', enabled: true, classification: 'DASHBOARD HANDOFF', botFatherVisible: false },
  { cmd: '/setcost', category: 'TEAM', desc: 'Update loader cost for a bundle', role: 'Owner', enabled: true, classification: 'DASHBOARD HANDOFF', botFatherVisible: false },
  { cmd: '/setprices', category: 'TEAM', desc: 'Batch update selling prices', role: 'Owner', enabled: true, classification: 'DASHBOARD HANDOFF', botFatherVisible: false },
  { cmd: '/setcosts', category: 'TEAM', desc: 'Batch update loader costs', role: 'Owner', enabled: true, classification: 'DASHBOARD HANDOFF', botFatherVisible: false },
  { cmd: '/broadcast', category: 'TEAM', desc: 'Send a message to all active groups', role: 'Owner', enabled: true, classification: 'DASHBOARD HANDOFF', botFatherVisible: false },
  { cmd: '/pricebroadcast', category: 'TEAM', desc: 'Broadcast assigned price lists to customer groups', role: 'Owner', enabled: true, classification: 'FUNCTIONAL', botFatherVisible: false },
  { cmd: '/remind', category: 'TEAM', desc: 'Send payment reminder for an unpaid order', role: 'Staff', enabled: true, classification: 'FUNCTIONAL', botFatherVisible: false },
  { cmd: '/remind_all_unpaid', category: 'TEAM', desc: 'Send payment reminders to all customer groups with unpaid orders', role: 'Staff', enabled: true, classification: 'FUNCTIONAL', botFatherVisible: false },
  { cmd: '/remind_unpaid', category: 'TEAM', desc: 'Alias for /remind_all_unpaid', role: 'Staff', enabled: true, classification: 'FUNCTIONAL', botFatherVisible: false },
];

export const COMMAND_REQUIRED_PERMISSIONS: Record<string, string[]> = {
  '/pending': ['order.process'],
  '/groups': ['routing.update'],
  '/sendpaydetails': ['broadcast.send'],
  '/setprice': ['price.update'],
  '/setcost': ['loaderPrice.override'],
  '/setprices': ['price.update'],
  '/setcosts': ['loaderPrice.override'],
  '/broadcast': ['broadcast.send'],
  '/pricebroadcast': ['broadcast.send'],
  '/remind': ['order.process'],
  '/remind_all_unpaid': ['broadcast.send'],
  '/remind_unpaid': ['broadcast.send'],
  '/calc': ['order.process'],
  '/total': ['order.process'],
  '/undo': ['order.process'],
  '/clearcalc': ['order.process'],
  '/reset': ['order.process'],
  '/id': ['order.process', 'routing.update'],
  '/stats': ['admin.stats'],
};


