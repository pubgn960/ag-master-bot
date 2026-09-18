import { expect, test, describe } from 'vitest';
import { DeterministicOrderParser, isIgnorableChatMessage, hasOrderIntent, extractCpAmount, parseTelegramOrder } from '../../core/services/DeterministicOrderParser';
import { extractCpAmount as extractCpFromUtil, parseTelegramOrder as parseFromUtil } from '../../utils/parser';
import { extractCpAmount as extractCpFromHandler, parseTelegramOrder as parseFromHandler } from '../../bot/handlers/orderParser';

describe('DeterministicOrderParser', () => {
    const parser = new DeterministicOrderParser();

    test('ACTIVISION VALID: Email, Password, CP', () => {
        const text = `10800 CP\nuser@example.com\npassword123`;
        const res = parser.extract(text);
        expect(res.decision).to.equal('ACCEPT');
        expect(res.orders[0].productCode).to.equal('ACTIVISION');
        expect(res.orders[0].fields['email'].value).to.equal('user@example.com');
    });

    test('ACTIVISION VALID: Email, Password, CP, IGN', () => {
        const text = `10800 CP\nuser@example.com\npassword123\nign: myname`;
        const res = parser.extract(text);
        expect(res.decision).to.equal('ACCEPT');
        expect(res.orders[0].fields['ign'].value).to.equal('myname');
    });

    test('ACTIVISION INVALID: Phone, Password, CP without Email', () => {
        const text = `ACTIVISION\n10800 CP\n+1-555-123-4567\npassword123`;
        const res = parser.extract(text);
        expect(res.decision).to.equal('INCOMPLETE');
        expect(res.missingFields).to.include('Email');
    });

    test('FACEBOOK VALID: International Phone, Password, 2FA Backup Codes, CP', () => {
        const text = `10800 CP\n+1-555-123-4567\npassword123\n2fa: 12345678`;
        const res = parser.extract(text);
        expect(res.decision).to.equal('ACCEPT');
        expect(res.orders[0].productCode).to.equal('FACEBOOK');
        expect(res.orders[0].fields['phone'].value).to.equal('+15551234567');
        expect(res.orders[0].fields['backupCodes'].value).to.equal('12345678');
    });

    test('FACEBOOK VALID: International Phone, Password, 2FA Backup Codes, CP, IGN', () => {
        const text = `10800 CP\n+1-555-123-4567\npassword123\n2fa: 12345678\nign: myname`;
        const res = parser.extract(text);
        expect(res.decision).to.equal('ACCEPT');
        expect(res.orders[0].productCode).to.equal('FACEBOOK');
    });

    test('FACEBOOK INVALID: Phone, Password, CP without Backup Codes', () => {
        const text = `FACEBOOK\n10800 CP\n+1-555-123-4567\npassword123`;
        const res = parser.extract(text);
        expect(res.decision).to.equal('INCOMPLETE');
        expect(res.missingFields).to.include('2FA Backup Codes');
    });

    test('FACEBOOK INVALID: Email, Password, Backup Codes, CP without Phone', () => {
        const text = `FACEBOOK\n10800 CP\nuser@example.com\npassword123\n2fa: 123456`;
        const res = parser.extract(text);
        expect(res.decision).to.equal('INCOMPLETE');
        expect(res.missingFields).to.include('Facebook Phone Number');
    });

    test('Multiple Orders: extracts multiple orders in batch', () => {
        const text = `order 1\n10800 CP\nuser@example.com\npassword123\norder 2\n10800 CP\nuser2@example.com\npassword456`;
        const res = parser.extract(text);
        expect(res.decision).to.equal('ACCEPT');
        expect(res.orders).toHaveLength(2);
        expect(res.orders[0].cpQuantity).to.equal(10800);
        expect(res.orders[0].fields['email'].value).to.equal('user@example.com');
        expect(res.orders[1].cpQuantity).to.equal(10800);
        expect(res.orders[1].fields['email'].value).to.equal('user2@example.com');
    });

    // ==========================================================
    // Ignorable Chat & Mention-Only Tests
    // ==========================================================

    test('MENTION ONLY: @CODM_girl_yt is ignored as NOT_ORDER', () => {
        expect(isIgnorableChatMessage('@CODM_girl_yt')).to.equal(true);
        expect(hasOrderIntent('@CODM_girl_yt')).to.equal(false);
        const res = parser.extract('@CODM_girl_yt');
        expect(res.decision).to.equal('NOT_ORDER');
        expect(res.orders).to.have.lengthOf(0);
    });

    test('MENTION ONLY: @someuser is ignored as NOT_ORDER', () => {
        expect(isIgnorableChatMessage('@someuser')).to.equal(true);
        expect(hasOrderIntent('@someuser')).to.equal(false);
        const res = parser.extract('@someuser');
        expect(res.decision).to.equal('NOT_ORDER');
        expect(res.orders).to.have.lengthOf(0);
    });

    test('ORDINARY CHAT: hello is ignored as NOT_ORDER', () => {
        expect(isIgnorableChatMessage('hello')).to.equal(true);
        expect(hasOrderIntent('hello')).to.equal(false);
        const res = parser.extract('hello');
        expect(res.decision).to.equal('NOT_ORDER');
        expect(res.orders).to.have.lengthOf(0);
    });

    test('ORDINARY CHAT: thanks is ignored as NOT_ORDER', () => {
        expect(isIgnorableChatMessage('thanks')).to.equal(true);
        expect(hasOrderIntent('thanks')).to.equal(false);
        const res = parser.extract('thanks');
        expect(res.decision).to.equal('NOT_ORDER');
        expect(res.orders).to.have.lengthOf(0);
    });

    test('ORDINARY CHAT: ok and done are ignored as NOT_ORDER', () => {
        expect(isIgnorableChatMessage('ok')).to.equal(true);
        expect(isIgnorableChatMessage('done')).to.equal(true);
        expect(parser.extract('ok').decision).to.equal('NOT_ORDER');
        expect(parser.extract('done').decision).to.equal('NOT_ORDER');
    });

    test('ORDINARY CHAT WITH MENTION: bro @loader check this is ignored as NOT_ORDER', () => {
        const text = 'bro @loader check this';
        expect(isIgnorableChatMessage(text)).to.equal(true);
        expect(hasOrderIntent(text)).to.equal(false);
        const res = parser.extract(text);
        expect(res.decision).to.equal('NOT_ORDER');
        expect(res.orders).to.have.lengthOf(0);
    });

    // ==========================================================
    // Real Order Acceptance Tests
    // ==========================================================

    test('REAL ORDER ACCEPTED: Activision 80 CP with email & password', () => {
        const text = `Activision\n80 CP\nemail: test@example.com\npassword: Test12345`;
        expect(isIgnorableChatMessage(text)).to.equal(false);
        expect(hasOrderIntent(text)).to.equal(true);
        const res = parser.extract(text);
        expect(res.decision).to.equal('ACCEPT');
        expect(res.orders).to.have.lengthOf(1);
        expect(res.orders[0].productCode).to.equal('ACTIVISION');
        expect(res.orders[0].cpQuantity).to.equal(80);
        expect(res.orders[0].fields['email'].value).to.equal('test@example.com');
        expect(res.orders[0].fields['password'].value).to.equal('Test12345');
    });

    test('REAL ORDER ACCEPTED: #1 80 CP Login Mail Pass format', () => {
        const text = `#1\n80 CP\nLogin: Activision\nMail: test@example.com\nPass: Test12345`;
        expect(isIgnorableChatMessage(text)).to.equal(false);
        expect(hasOrderIntent(text)).to.equal(true);
        const res = parser.extract(text);
        expect(res.decision).to.equal('ACCEPT');
        expect(res.orders).to.have.lengthOf(1);
        expect(res.orders[0].productCode).to.equal('ACTIVISION');
        expect(res.orders[0].cpQuantity).to.equal(80);
        expect(res.orders[0].fields['email'].value).to.equal('test@example.com');
        expect(res.orders[0].fields['password'].value).to.equal('Test12345');
    });

    // ==========================================================
    // CP Extraction Format & Edge Case Tests
    // ==========================================================

    describe('CP Extraction Formats and Edge Cases', () => {
        test('Extracts strictly integer 10800 from all specified formats', () => {
            expect(extractCpAmount('10800')).to.equal(10800);
            expect(extractCpFromUtil('10800')).to.equal(10800);
            expect(extractCpFromHandler('10800')).to.equal(10800);
            expect(extractCpAmount('10,800')).to.equal(10800);
            expect(extractCpAmount('CP 10800')).to.equal(10800);
            expect(extractCpAmount('CP: 10,800')).to.equal(10800);
            expect(extractCpAmount('10800 CP')).to.equal(10800);
            expect(extractCpAmount('10,800cp')).to.equal(10800);
            expect(extractCpAmount('cp-10800')).to.equal(10800);
            expect(extractCpAmount('amount: 10,800')).to.equal(10800);
            expect(extractCpAmount('108,000')).to.equal(108000);
            expect(extractCpAmount('108,000 CP')).to.equal(108000);
        });

        test('Handles edge cases: multiple distinct bundles in multi-order format return null', () => {
            expect(extractCpAmount('order 1: 10800\norder 2: 5000')).to.equal(null);
        });

        test('Handles multi-bundle additions: sums combined bundles predictably', () => {
            expect(extractCpAmount('5,000 cod points and 880 cod points')).to.equal(5880);
            expect(extractCpAmount('5,000 + 880')).to.equal(5880);
            expect(extractCpAmount('5000cp + 880cp')).to.equal(5880);
            expect(extractCpAmount('5000 and 880')).to.equal(5880);
            expect(extractCpAmount('5000 & 880')).to.equal(5880);
            expect(extractCpAmount('5000 + 880 + 420')).to.equal(6300);
            expect(extractCpAmount('10800 CP and 5000 CP')).to.equal(15800);
        });

        test('Rejects price decimals from being falsely parsed as CP', () => {
            expect(extractCpAmount('30.5+7.5')).to.equal(null);
            expect(extractCpAmount('$30.50 + $7.50')).to.equal(null);
        });

        test('Handles edge cases: repeated identical bundle amount succeeds', () => {
            expect(extractCpAmount('CP: 10,800 (10,800 CP)')).to.equal(10800);
        });

        test('Handles edge cases: invalid amounts return null', () => {
            expect(extractCpAmount('0 CP')).to.equal(null);
            expect(extractCpAmount('-10800 CP')).to.equal(null);
            expect(extractCpAmount('9999999 CP')).to.equal(null);
            expect(extractCpAmount('500')).to.equal(null); // Unknown standalone bundle size without CP keyword
            expect(extractCpAmount('hello world')).to.equal(null);
            expect(extractCpAmount('')).to.equal(null);
            expect(extractCpAmount(null as any)).to.equal(null);
        });

        test('Prevents false positives on passwords or credentials', () => {
            expect(extractCpAmount('pass: 10800')).to.equal(null);
            expect(extractCpAmount('txid: 10800')).to.equal(null);
            expect(extractCpAmount('user@example.com\npassword123\nCP: 10,800')).to.equal(10800);
        });

        test('DeterministicOrderParser accepts order with CP: 10,800 prefix', () => {
            const text = `CP: 10,800\nuser@example.com\npassword123`;
            const res = parser.extract(text);
            expect(res.decision).to.equal('ACCEPT');
            expect(res.orders[0].cpQuantity).to.equal(10800);
            expect(res.orders[0].fields['email'].value).to.equal('user@example.com');
            expect(res.orders[0].fields['password'].value).to.equal('password123');
        });

        test('DeterministicOrderParser accepts order with standalone 10,800 line and comma', () => {
            const text = `10,800\nuser@example.com\npassword123`;
            const res = parser.extract(text);
            expect(res.decision).to.equal('ACCEPT');
            expect(res.orders[0].cpQuantity).to.equal(10800);
            expect(res.orders[0].fields['email'].value).to.equal('user@example.com');
            expect(res.orders[0].fields['password'].value).to.equal('password123');
        });

        test('DeterministicOrderParser accepts order with 10,800cp suffix', () => {
            const text = `user@example.com\npassword123\n10,800cp`;
            const res = parser.extract(text);
            expect(res.decision).to.equal('ACCEPT');
            expect(res.orders[0].cpQuantity).to.equal(10800);
            expect(res.orders[0].fields['password'].value).to.equal('password123');
        });

        test('DeterministicOrderParser accepts order with cp-10800 hyphenated format', () => {
            const text = `user@example.com\npassword123\ncp-10800`;
            const res = parser.extract(text);
            expect(res.decision).to.equal('ACCEPT');
            expect(res.orders[0].cpQuantity).to.equal(10800);
            expect(res.orders[0].fields['password'].value).to.equal('password123');
        });

        test('DeterministicOrderParser flags multiple bundles as ONE_ORDER_PER_MESSAGE', () => {
            const text = `10,800 CP\n5000 CP\nuser@example.com\npassword123`;
            const res = parser.extract(text);
            expect(res.decision).to.equal('ONE_ORDER_PER_MESSAGE');
        });

        test('DeterministicOrderParser handles incomplete order with CP: 10,800 without credentials', () => {
            const text = `CP: 10,800`;
            expect(hasOrderIntent(text)).to.equal(true);
            const res = parser.extract(text);
            // Standalone CP without credentials or login type is AMBIGUOUS or INCOMPLETE
            expect(['INCOMPLETE', 'AMBIGUOUS']).to.include(res.decision);
        });
    });

    describe('parseTelegramOrder (Bulletproof CP & Credential Parser)', () => {
        test('parses 10800 CP with email and password labels', () => {
            const text = `Activision\n10800 CP\nemail: user@test.com\npassword: secret123`;
            const res = parseTelegramOrder(text);
            expect(res).not.toBeNull();
            expect(res?.loginType).toBe('Activision');
            expect(res?.cpAmount).toBe(10800);
            expect(res?.email).toBe('user@test.com');
            expect(res?.password).toBe('secret123');
        });

        test('parses 10,800cp with comma stripping and pw shorthand', () => {
            const text = `Activision\n10,800cp\nlogin: player@codm.com\npw: mypass456`;
            const res = parseTelegramOrder(text);
            expect(res).not.toBeNull();
            expect(res?.cpAmount).toBe(10800);
            expect(res?.email).toBe('player@codm.com');
            expect(res?.password).toBe('mypass456');
        });

        test('parses CP: 10,800 prefix format with pass shorthand', () => {
            const text = `Facebook\nCP: 10,800\nuser: fbuser@mail.com\npass: fbpass789`;
            const res = parseTelegramOrder(text);
            expect(res).not.toBeNull();
            expect(res?.loginType).toBe('Facebook');
            expect(res?.cpAmount).toBe(10800);
            expect(res?.email).toBe('fbuser@mail.com');
            expect(res?.password).toBe('fbpass789');
        });

        test('parses CP 10800 space prefix format', () => {
            const text = `Garena\nCP 10800\nid: garenaplayer@gg.com\npassword: garenasecret`;
            const res = parseTelegramOrder(text);
            expect(res).not.toBeNull();
            expect(res?.loginType).toBe('Garena');
            expect(res?.cpAmount).toBe(10800);
            expect(res?.email).toBe('garenaplayer@gg.com');
            expect(res?.password).toBe('garenasecret');
        });

        test('parses standalone 10,800 line with commas', () => {
            const text = `Activision\n10,800\nusername: codm_user@gmail.com\npassword: codmpassword`;
            const res = parseTelegramOrder(text);
            expect(res).not.toBeNull();
            expect(res?.cpAmount).toBe(10800);
            expect(res?.email).toBe('codm_user@gmail.com');
            expect(res?.password).toBe('codmpassword');
        });

        test('parses large bundles up to 108,000 CP', () => {
            const text = `Activision\n108,000 CP\nemail: whale@gaming.com\npassword: superSecretPass1`;
            const res = parseTelegramOrder(text);
            expect(res).not.toBeNull();
            expect(res?.cpAmount).toBe(108000);
            expect(res?.email).toBe('whale@gaming.com');
            expect(res?.password).toBe('superSecretPass1');
        });

        test('parses minimum 80 CP bundle', () => {
            const text = `Activision\n80 CP\nemail: starter@gaming.com\npw: pass80`;
            const res = parseTelegramOrder(text);
            expect(res).not.toBeNull();
            expect(res?.cpAmount).toBe(80);
        });

        test('parses orders without credential labels and extracts IGN', () => {
            const text = `Activision\n10,800 CP\nplayer@gmail.com\nsecretPass123\nIGN: ProSniper`;
            const res = parseTelegramOrder(text);
            expect(res).not.toBeNull();
            expect(res?.loginType).toBe('Activision');
            expect(res?.cpAmount).toBe(10800);
            expect(res?.email).toBe('player@gmail.com');
            expect(res?.password).toBe('secretPass123');
            expect(res?.ign).toBe('ProSniper');
        });

        test('parses Facebook orders with backup codes and IGN', () => {
            const text = `Facebook\n5000 CP\nlogin: +1234567890\npassword: fbPassword\nign: Slayer\nbackup codes:\n1122 3344\n5566 7788`;
            const res = parseTelegramOrder(text);
            expect(res).not.toBeNull();
            expect(res?.loginType).toBe('Facebook');
            expect(res?.cpAmount).toBe(5000);
            expect(res?.email).toBe('+1234567890');
            expect(res?.password).toBe('fbPassword');
            expect(res?.ign).toBe('Slayer');
            expect(res?.backupCodes).toContain('1122 3344');
        });

        test('returns null for empty, missing credentials, or invalid input', () => {
            expect(parseTelegramOrder('')).toBeNull();
            expect(parseTelegramOrder('hello world')).toBeNull();
            expect(parseTelegramOrder('10800 CP\nemail: foo@bar.com')).toBeNull(); // missing password
            expect(parseTelegramOrder('10800 CP\npassword: secret')).toBeNull(); // missing email
            expect(parseTelegramOrder('user@test.com\npassword: secret')).toBeNull(); // missing CP
        });

        test('parses multi-bundle orders with breakdown and combined total', () => {
            const text = `Activision\n5,000 cod points and 880 cod points\nplayer@gmail.com\nsecretPass123\nIGN: ProSniper`;
            const res = parseTelegramOrder(text);
            expect(res).not.toBeNull();
            expect(res?.loginType).toBe('Activision');
            expect(res?.cpAmount).toBe(5880);
            expect(res?.bundleBreakdown).toEqual([5000, 880]);
            expect(res?.bundleBreakdownText).toBe('5,000 + 880');
            expect(res?.email).toBe('player@gmail.com');
            expect(res?.password).toBe('secretPass123');

            const parserRes = parser.extract(text);
            expect(parserRes.decision).toBe('ACCEPT');
            expect(parserRes.orders[0].cpQuantity).toBe(5880);
            expect(parserRes.orders[0].bundleBreakdown).toEqual([5000, 880]);
        });

        test('parses 5000 + 880 addition order', () => {
            const text = `5,000 + 880\nuser@example.com\npassword123`;
            const res = parseTelegramOrder(text);
            expect(res).not.toBeNull();
            expect(res?.cpAmount).toBe(5880);

            const parserRes = parser.extract(text);
            expect(parserRes.decision).toBe('ACCEPT');
            expect(parserRes.orders[0].cpQuantity).toBe(5880);
        });

        test('parses 5000cp + 880cp + 420cp three-bundle order', () => {
            const text = `5000cp + 880cp + 420cp\nuser@example.com\npassword123`;
            const res = parseTelegramOrder(text);
            expect(res).not.toBeNull();
            expect(res?.cpAmount).toBe(6300);
            expect(res?.bundleBreakdown).toEqual([5000, 880, 420]);

            const parserRes = parser.extract(text);
            expect(parserRes.decision).toBe('ACCEPT');
            expect(parserRes.orders[0].cpQuantity).toBe(6300);
        });

        test('exported identically across modules', () => {
            expect(parseFromUtil).toBe(parseTelegramOrder);
            expect(parseFromHandler).toBe(parseTelegramOrder);
        });
    });
});

