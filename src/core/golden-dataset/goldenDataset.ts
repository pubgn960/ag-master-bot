export interface GoldenSample {
  id: string;
  category:
    | 'ORDER_CLEAN'
    | 'ORDER_MESSY'
    | 'ORDER_MULTILINGUAL'
    | 'ORDER_FOLLOWUP'
    | 'ORDER_AMBIGUOUS'
    | 'PAYMENT_EXACT'
    | 'PAYMENT_PARTIAL'
    | 'PAYMENT_OVERPAY'
    | 'LOADER_PRICE_TEXT'
    | 'LOADER_PRICE_IMAGE'
    | 'LOADER_PRICE_AMBIGUOUS'
    | 'LOADER_PRICE_ANOMALY'
    | 'PROMOTION_ORDER';
  description: string;
  messages: Array<{
    senderId: number;
    senderName: string;
    text: string;
    imageRef?: string;
    replyToMessageId?: number;
  }>;
  expectedResult: {
    isOrder?: boolean;
    cpQuantity?: number;
    productCode?: string;
    expectedEmail?: string;
    expectedPhone?: string;
    expectedPassword?: string;
    expectedPaymentAmount?: number;
    expectedPriceAction?: 'APPLY' | 'REVIEW_NEEDED' | 'BLOCKED_ANOMALY';
    expectedAnomalyReason?: string;
    shouldFailValidation?: boolean;
  };
}

export const GOLDEN_DATASET: GoldenSample[] = [
  // 1-10: Clean Orders
  {
    id: 'G-001',
    category: 'ORDER_CLEAN',
    description: 'Standard single line Activision 5000 CP order',
    messages: [{ senderId: 101, senderName: 'Alice', text: '5000 cp act email: alice@gmail.com pass: Secret123!' }],
    expectedResult: { isOrder: true, cpQuantity: 5000, productCode: 'ACTIVISION', expectedEmail: 'alice@gmail.com', expectedPassword: 'Secret123!' },
  },
  {
    id: 'G-002',
    category: 'ORDER_CLEAN',
    description: 'Activision 10800 CP with IGN',
    messages: [{ senderId: 102, senderName: 'Bob', text: '10800 CP\nemail: bob.gaming@yahoo.com\npassword: P@ssw0rd2026\nIGN: BobSlayer' }],
    expectedResult: { isOrder: true, cpQuantity: 10800, productCode: 'ACTIVISION', expectedEmail: 'bob.gaming@yahoo.com', expectedPassword: 'P@ssw0rd2026' },
  },
  {
    id: 'G-003',
    category: 'ORDER_CLEAN',
    description: 'Facebook login 5000 CP with international phone',
    messages: [{ senderId: 103, senderName: 'Carlos', text: 'fb 5000 cp phone: +12025550199 pass: MyFbPass99 backup: 11223344, 55667788' }],
    expectedResult: { isOrder: true, cpQuantity: 5000, productCode: 'FACEBOOK', expectedPhone: '+12025550199', expectedPassword: 'MyFbPass99' },
  },
  {
    id: 'G-004',
    category: 'ORDER_CLEAN',
    description: 'Activision 2400 CP compact format',
    messages: [{ senderId: 104, senderName: 'Dave', text: '2400 cp dave@outlook.com pw: davePass777' }],
    expectedResult: { isOrder: true, cpQuantity: 2400, productCode: 'ACTIVISION', expectedEmail: 'dave@outlook.com', expectedPassword: 'davePass777' },
  },
  {
    id: 'G-005',
    category: 'ORDER_CLEAN',
    description: 'Activision 880 CP standard',
    messages: [{ senderId: 105, senderName: 'Emma', text: '880 cp\nemail: emma@icloud.com\npass: EmmaPass2026' }],
    expectedResult: { isOrder: true, cpQuantity: 880, productCode: 'ACTIVISION', expectedEmail: 'emma@icloud.com', expectedPassword: 'EmmaPass2026' },
  },
  {
    id: 'G-006',
    category: 'ORDER_CLEAN',
    description: 'Activision 420 CP starter bundle',
    messages: [{ senderId: 106, senderName: 'Frank', text: '420 CP frankie@gmail.com pass: Franko99' }],
    expectedResult: { isOrder: true, cpQuantity: 420, productCode: 'ACTIVISION', expectedEmail: 'frankie@gmail.com', expectedPassword: 'Franko99' },
  },
  {
    id: 'G-007',
    category: 'ORDER_CLEAN',
    description: 'Facebook 2400 CP with country code phone',
    messages: [{ senderId: 107, senderName: 'George', text: 'facebook 2400 cp\nphone: +447911123456\npassword: GeorgeSecure1' }],
    expectedResult: { isOrder: true, cpQuantity: 2400, productCode: 'FACEBOOK', expectedPhone: '+447911123456', expectedPassword: 'GeorgeSecure1' },
  },
  {
    id: 'G-008',
    category: 'ORDER_CLEAN',
    description: 'Facebook 10800 CP with codes',
    messages: [{ senderId: 108, senderName: 'Helen', text: '10800 cp fb\nphone: +33612345678\npass: HelenSecret\ncodes: 12345678 87654321' }],
    expectedResult: { isOrder: true, cpQuantity: 10800, productCode: 'FACEBOOK', expectedPhone: '+33612345678', expectedPassword: 'HelenSecret' },
  },
  {
    id: 'G-009',
    category: 'ORDER_CLEAN',
    description: 'Activision 5000 CP with phone login',
    messages: [{ senderId: 109, senderName: 'Ivan', text: 'activision 5000 cp phone: +971501234567 pass: IvanPass! ign: RedViper' }],
    expectedResult: { isOrder: true, cpQuantity: 5000, productCode: 'ACTIVISION', expectedPhone: '+971501234567', expectedPassword: 'IvanPass!' },
  },
  {
    id: 'G-010',
    category: 'ORDER_CLEAN',
    description: 'Activision 5000 CP hyphen notation',
    messages: [{ senderId: 110, senderName: 'Julia', text: '5000 CP - julia@domain.com - pass: JuliaSecure#1' }],
    expectedResult: { isOrder: true, cpQuantity: 5000, productCode: 'ACTIVISION', expectedEmail: 'julia@domain.com', expectedPassword: 'JuliaSecure#1' },
  },

  // 11-20: Multilingual Orders
  {
    id: 'G-011',
    category: 'ORDER_MULTILINGUAL',
    description: 'Spanish Activision order',
    messages: [{ senderId: 111, senderName: 'Mateo', text: 'Hola quiero 5000 cp activision\ncorreo: mateo@correo.es\ncontrasena: Mateo1234' }],
    expectedResult: { isOrder: true, cpQuantity: 5000, productCode: 'ACTIVISION', expectedEmail: 'mateo@correo.es', expectedPassword: 'Mateo1234' },
  },
  {
    id: 'G-012',
    category: 'ORDER_MULTILINGUAL',
    description: 'Portuguese Facebook order',
    messages: [{ senderId: 112, senderName: 'Lucas', text: 'Quero 10800 cp facebook tel: +5511987654321 senha: LucasPass2026' }],
    expectedResult: { isOrder: true, cpQuantity: 10800, productCode: 'FACEBOOK', expectedPhone: '+5511987654321', expectedPassword: 'LucasPass2026' },
  },
  {
    id: 'G-013',
    category: 'ORDER_MULTILINGUAL',
    description: 'Arabic Activision order with phone',
    messages: [{ senderId: 113, senderName: 'Ahmed', text: 'طلب 5000 cp رقم: +966501234567 pass: AhmedPass99' }],
    expectedResult: { isOrder: true, cpQuantity: 5000, productCode: 'ACTIVISION', expectedPhone: '+966501234567', expectedPassword: 'AhmedPass99' },
  },
  {
    id: 'G-014',
    category: 'ORDER_MULTILINGUAL',
    description: 'Russian Activision order',
    messages: [{ senderId: 114, senderName: 'Dmitry', text: 'Привет 2400 cp активайс почта: dmitry@mail.ru пароль: DimaPassword77' }],
    expectedResult: { isOrder: true, cpQuantity: 2400, productCode: 'ACTIVISION', expectedEmail: 'dmitry@mail.ru', expectedPassword: 'DimaPassword77' },
  },
  {
    id: 'G-015',
    category: 'ORDER_MULTILINGUAL',
    description: 'French Activision order',
    messages: [{ senderId: 115, senderName: 'Jean', text: 'Bonjour 5000 CP email: jean@free.fr mot de passe: JeanSecret99' }],
    expectedResult: { isOrder: true, cpQuantity: 5000, productCode: 'ACTIVISION', expectedEmail: 'jean@free.fr', expectedPassword: 'JeanSecret99' },
  },
  {
    id: 'G-016',
    category: 'ORDER_MULTILINGUAL',
    description: 'German Facebook order',
    messages: [{ senderId: 116, senderName: 'Hans', text: 'Hallo fb 2400 cp phone: +491511234567 pass: HansPass2026' }],
    expectedResult: { isOrder: true, cpQuantity: 2400, productCode: 'FACEBOOK', expectedPhone: '+491511234567', expectedPassword: 'HansPass2026' },
  },
  {
    id: 'G-017',
    category: 'ORDER_MULTILINGUAL',
    description: 'Italian Activision order',
    messages: [{ senderId: 117, senderName: 'Marco', text: 'Vorrei 880 cp email: marco@tin.it password: MarcoPass1!' }],
    expectedResult: { isOrder: true, cpQuantity: 880, productCode: 'ACTIVISION', expectedEmail: 'marco@tin.it', expectedPassword: 'MarcoPass1!' },
  },
  {
    id: 'G-018',
    category: 'ORDER_MULTILINGUAL',
    description: 'Turkish Activision order',
    messages: [{ senderId: 118, senderName: 'Can', text: '5000 cp yukleme email: can@yandex.com sifre: CanSifre2026' }],
    expectedResult: { isOrder: true, cpQuantity: 5000, productCode: 'ACTIVISION', expectedEmail: 'can@yandex.com', expectedPassword: 'CanSifre2026' },
  },
  {
    id: 'G-019',
    category: 'ORDER_MULTILINGUAL',
    description: 'Indonesian Facebook order',
    messages: [{ senderId: 119, senderName: 'Budi', text: 'Order fb 5000 cp hp: +628123456789 pass: BudiJaya99' }],
    expectedResult: { isOrder: true, cpQuantity: 5000, productCode: 'FACEBOOK', expectedPhone: '+628123456789', expectedPassword: 'BudiJaya99' },
  },
  {
    id: 'G-020',
    category: 'ORDER_MULTILINGUAL',
    description: 'Tagalog Activision order',
    messages: [{ senderId: 120, senderName: 'Juan', text: '5000 cp po email: juan@gmail.com pass: JuanSecret10' }],
    expectedResult: { isOrder: true, cpQuantity: 5000, productCode: 'ACTIVISION', expectedEmail: 'juan@gmail.com', expectedPassword: 'JuanSecret10' },
  },

  // 21-30: Multi-message & Follow-up Orders
  {
    id: 'G-021',
    category: 'ORDER_FOLLOWUP',
    description: 'Follow-up password in second message',
    messages: [
      { senderId: 121, senderName: 'Kevin', text: '5000 cp email: kevin@gmail.com' },
      { senderId: 121, senderName: 'Kevin', text: 'pass: KevinPass888' },
    ],
    expectedResult: { isOrder: true, cpQuantity: 5000, expectedEmail: 'kevin@gmail.com', expectedPassword: 'KevinPass888' },
  },
  {
    id: 'G-022',
    category: 'ORDER_FOLLOWUP',
    description: 'Follow-up phone number format correction',
    messages: [
      { senderId: 122, senderName: 'Leo', text: 'fb 2400 cp pass: LeoPass' },
      { senderId: 122, senderName: 'Leo', text: 'phone: +13105550144' },
    ],
    expectedResult: { isOrder: true, cpQuantity: 2400, expectedPhone: '+13105550144', expectedPassword: 'LeoPass' },
  },
  {
    id: 'G-023',
    category: 'ORDER_AMBIGUOUS',
    description: 'Missing country code phone number fails validation with explicit message',
    messages: [{ senderId: 123, senderName: 'Max', text: 'fb 5000 cp phone: 5550199 pass: MaxPass' }],
    expectedResult: { isOrder: true, shouldFailValidation: true },
  },
  {
    id: 'G-024',
    category: 'ORDER_AMBIGUOUS',
    description: 'Email sent for Facebook product (email forbidden for Facebook)',
    messages: [{ senderId: 124, senderName: 'Nina', text: 'facebook 5000 cp email: nina@gmail.com pass: NinaPass' }],
    expectedResult: { isOrder: true, productCode: 'FACEBOOK', shouldFailValidation: true },
  },
  {
    id: 'G-025',
    category: 'ORDER_CLEAN',
    description: 'Activision 5000 CP with space separated fields',
    messages: [{ senderId: 125, senderName: 'Oscar', text: '5000 CP oscar@mail.com pass: OscarPass99' }],
    expectedResult: { isOrder: true, cpQuantity: 5000, expectedEmail: 'oscar@mail.com', expectedPassword: 'OscarPass99' },
  },

  // 26-35: Payments
  {
    id: 'G-026',
    category: 'PAYMENT_EXACT',
    description: 'Exact full payment $31 for 5000 CP order',
    messages: [{ senderId: 126, senderName: 'Paul', text: 'Paid $31 via Binance Pay TXID: TX_BINANCE_1001' }],
    expectedResult: { expectedPaymentAmount: 31.0 },
  },
  {
    id: 'G-027',
    category: 'PAYMENT_PARTIAL',
    description: 'Partial payment $26 for $31 order ($5 remaining)',
    messages: [{ senderId: 127, senderName: 'Queen', text: 'Sent $26 Binance Pay TXID: TX_BINANCE_1002' }],
    expectedResult: { expectedPaymentAmount: 26.0 },
  },
  {
    id: 'G-028',
    category: 'PAYMENT_OVERPAY',
    description: 'Overpayment $40 for $31 order ($9 customer balance credit)',
    messages: [{ senderId: 128, senderName: 'Rick', text: 'Paid $40 TXID: TX_OVERPAY_40' }],
    expectedResult: { expectedPaymentAmount: 40.0 },
  },
  {
    id: 'G-029',
    category: 'PAYMENT_EXACT',
    description: 'Payment screenshot submission',
    messages: [{ senderId: 129, senderName: 'Sam', text: 'Payment proof attached', imageRef: 'mock_pay_screenshot_31.png' }],
    expectedResult: { expectedPaymentAmount: 31.0 },
  },
  {
    id: 'G-030',
    category: 'PAYMENT_EXACT',
    description: 'Payment before order (creates credit, auto-allocates to subsequent order)',
    messages: [{ senderId: 130, senderName: 'Tom', text: 'Deposited $31 TXID: TX_PREPAY_31' }],
    expectedResult: { expectedPaymentAmount: 31.0 },
  },

  // 31-40: Loader Price Updates
  {
    id: 'G-031',
    category: 'LOADER_PRICE_TEXT',
    description: 'Clear new loader price list',
    messages: [{
      senderId: 901,
      senderName: 'LoaderAlpha',
      text: 'Today prices:\n420 = 2.50\n880 = 5.20\n2400 = 14.00\n5000 = 29.00\n10800 = 58.00',
    }],
    expectedResult: { expectedPriceAction: 'APPLY' },
  },
  {
    id: 'G-032',
    category: 'LOADER_PRICE_AMBIGUOUS',
    description: 'Ambiguous chatter from loader - must NOT auto-apply',
    messages: [{
      senderId: 901,
      senderName: 'LoaderAlpha',
      text: '5000 was 29 yesterday maybe tomorrow 30',
    }],
    expectedResult: { expectedPriceAction: 'REVIEW_NEEDED' },
  },
  {
    id: 'G-033',
    category: 'LOADER_PRICE_ANOMALY',
    description: 'Extreme price change $29 -> $290 (anomaly guard must block)',
    messages: [{
      senderId: 901,
      senderName: 'LoaderAlpha',
      text: 'New rates:\n5000 = 290.00',
    }],
    expectedResult: { expectedPriceAction: 'BLOCKED_ANOMALY', expectedAnomalyReason: 'Increase exceeds max allowed' },
  },
  {
    id: 'G-034',
    category: 'LOADER_PRICE_TEXT',
    description: 'Partial price list update for high CP bundles only',
    messages: [{
      senderId: 901,
      senderName: 'LoaderAlpha',
      text: 'New rate for big packages: 5000 = 28.50, 10800 = 57.00',
    }],
    expectedResult: { expectedPriceAction: 'APPLY' },
  },
  {
    id: 'G-035',
    category: 'LOADER_PRICE_IMAGE',
    description: 'Price list image sent by verified loader',
    messages: [{
      senderId: 901,
      senderName: 'LoaderAlpha',
      text: 'Updated price sheet attached',
      imageRef: 'mock_loader_prices.png',
    }],
    expectedResult: { expectedPriceAction: 'APPLY' },
  },

  // 41-50: Edge Cases & Promotions
  {
    id: 'G-036',
    category: 'PROMOTION_ORDER',
    description: 'Fixed promo order placed',
    messages: [{ senderId: 136, senderName: 'Uma', text: 'promo summer 5000 cp email: uma@gmail.com pass: UmaPass!' }],
    expectedResult: { isOrder: true, cpQuantity: 5000, expectedEmail: 'uma@gmail.com', expectedPassword: 'UmaPass!' },
  },
  {
    id: 'G-037',
    category: 'ORDER_CLEAN',
    description: 'Activision 10800 CP with full credentials',
    messages: [{ senderId: 137, senderName: 'Victor', text: '10800 CP victor@gmail.com pass: VictorSuperSecret!' }],
    expectedResult: { isOrder: true, cpQuantity: 10800, expectedEmail: 'victor@gmail.com', expectedPassword: 'VictorSuperSecret!' },
  },
  {
    id: 'G-038',
    category: 'ORDER_CLEAN',
    description: 'Activision 5000 CP with IGN and country code phone',
    messages: [{ senderId: 138, senderName: 'Wendy', text: '5000 CP phone: +14155550199 pass: Wendy999! ign: Valkyrie' }],
    expectedResult: { isOrder: true, cpQuantity: 5000, expectedPhone: '+14155550199', expectedPassword: 'Wendy999!' },
  },
  {
    id: 'G-039',
    category: 'PAYMENT_EXACT',
    description: 'Direct Bybit UID payment',
    messages: [{ senderId: 139, senderName: 'Xavier', text: 'Paid via Bybit $31 UID 12345678 TX: BYBIT_TX_001' }],
    expectedResult: { expectedPaymentAmount: 31.0 },
  },
  {
    id: 'G-040',
    category: 'PAYMENT_PARTIAL',
    description: 'Partial $15 payment for $31 order',
    messages: [{ senderId: 140, senderName: 'Yara', text: 'Sent $15 advance payment TX: TX_PARTIAL_15' }],
    expectedResult: { expectedPaymentAmount: 15.0 },
  },
  {
    id: 'G-041',
    category: 'ORDER_CLEAN',
    description: 'Clean Facebook 5000 CP with 2FA codes',
    messages: [{ senderId: 141, senderName: 'Zack', text: 'fb 5000 cp phone: +447700900077 pass: ZackPass#1 backup: 99887766' }],
    expectedResult: { isOrder: true, cpQuantity: 5000, expectedPhone: '+447700900077', expectedPassword: 'ZackPass#1' },
  },
  {
    id: 'G-042',
    category: 'ORDER_CLEAN',
    description: 'Clean Activision 420 CP',
    messages: [{ senderId: 142, senderName: 'Aaron', text: '420 cp aaron@gmail.com pass: Aaron2026' }],
    expectedResult: { isOrder: true, cpQuantity: 420, expectedEmail: 'aaron@gmail.com', expectedPassword: 'Aaron2026' },
  },
  {
    id: 'G-043',
    category: 'ORDER_CLEAN',
    description: 'Clean Activision 880 CP',
    messages: [{ senderId: 143, senderName: 'Bella', text: '880 cp bella@mail.com pass: BellaSecret' }],
    expectedResult: { isOrder: true, cpQuantity: 880, expectedEmail: 'bella@mail.com', expectedPassword: 'BellaSecret' },
  },
  {
    id: 'G-044',
    category: 'ORDER_CLEAN',
    description: 'Clean Activision 2400 CP',
    messages: [{ senderId: 144, senderName: 'Chris', text: '2400 cp chris@test.com pass: ChrisPass123' }],
    expectedResult: { isOrder: true, cpQuantity: 2400, expectedEmail: 'chris@test.com', expectedPassword: 'ChrisPass123' },
  },
  {
    id: 'G-045',
    category: 'ORDER_CLEAN',
    description: 'Clean Activision 5000 CP with caps',
    messages: [{ senderId: 145, senderName: 'Diana', text: '5000 CP DIANA@GMAIL.COM PASS: DianaSecure!' }],
    expectedResult: { isOrder: true, cpQuantity: 5000, expectedEmail: 'DIANA@GMAIL.COM', expectedPassword: 'DianaSecure!' },
  },
  {
    id: 'G-046',
    category: 'ORDER_CLEAN',
    description: 'Clean Activision 10800 CP with spaces',
    messages: [{ senderId: 146, senderName: 'Eli', text: '10800 cp  eli@yahoo.com   pass: EliSecretPass' }],
    expectedResult: { isOrder: true, cpQuantity: 10800, expectedEmail: 'eli@yahoo.com', expectedPassword: 'EliSecretPass' },
  },
  {
    id: 'G-047',
    category: 'ORDER_CLEAN',
    description: 'Facebook 2400 CP with UK phone',
    messages: [{ senderId: 147, senderName: 'Fiona', text: 'fb 2400 cp phone: +447890123456 pass: FionaPass123' }],
    expectedResult: { isOrder: true, cpQuantity: 2400, expectedPhone: '+447890123456', expectedPassword: 'FionaPass123' },
  },
  {
    id: 'G-048',
    category: 'ORDER_CLEAN',
    description: 'Facebook 5000 CP with UAE phone',
    messages: [{ senderId: 148, senderName: 'Gabe', text: 'fb 5000 cp phone: +971509876543 pass: GabeSecret!' }],
    expectedResult: { isOrder: true, cpQuantity: 5000, expectedPhone: '+971509876543', expectedPassword: 'GabeSecret!' },
  },
  {
    id: 'G-049',
    category: 'ORDER_CLEAN',
    description: 'Facebook 10800 CP with US phone',
    messages: [{ senderId: 149, senderName: 'Hannah', text: 'fb 10800 cp phone: +12125550177 pass: Hannah999 backup: 12345678' }],
    expectedResult: { isOrder: true, cpQuantity: 10800, expectedPhone: '+12125550177', expectedPassword: 'Hannah999' },
  },
  {
    id: 'G-050',
    category: 'ORDER_CLEAN',
    description: 'Activision 5000 CP order with quotes',
    messages: [{ senderId: 150, senderName: 'Ian', text: '5000 CP "ian@gmail.com" pass: "IanPass123"' }],
    expectedResult: { isOrder: true, cpQuantity: 5000, expectedEmail: 'ian@gmail.com', expectedPassword: 'IanPass123' },
  },
];
