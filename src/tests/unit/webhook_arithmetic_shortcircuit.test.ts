import { describe, it, expect } from 'vitest';
import { SafeMath } from '../../core/services/SafeMath';

describe('Webhook Arithmetic Short-Circuit & Order Isolation', () => {
  it('Owner sending 2+2 is classified as calculator shorthand and short-circuits before order processing', () => {
    const text = '2+2';
    const actorRole: string = 'OWNER';
    
    const isSlash = text.startsWith('/');
    const isArithmetic = SafeMath.isArithmeticShorthand(text);
    const isShortCircuit = isSlash || (isArithmetic && (actorRole === 'OWNER' || actorRole === 'STAFF'));

    expect(isShortCircuit).toBe(true);
  });

  it('Owner sending +69 is classified as calculator shorthand and short-circuits', () => {
    const text = '+69';
    const actorRole: string = 'OWNER';
    
    const isSlash = text.startsWith('/');
    const isArithmetic = SafeMath.isArithmeticShorthand(text);
    const isShortCircuit = isSlash || (isArithmetic && (actorRole === 'OWNER' || actorRole === 'STAFF'));

    expect(isShortCircuit).toBe(true);
  });

  it('Customer sending 2+2 is NOT classified as calculator shorthand and does NOT short-circuit', () => {
    const text = '2+2';
    const actorRole: string = 'CUSTOMER';
    
    const isSlash = text.startsWith('/');
    const isArithmetic = SafeMath.isArithmeticShorthand(text);
    const isShortCircuit = isSlash || (isArithmetic && (actorRole === 'OWNER' || actorRole === 'STAFF'));

    expect(isShortCircuit).toBe(false);
  });

  it('Owner sending plain 78 is classified as calculator shorthand and short-circuits', () => {
    const text = '78';
    const actorRole: string = 'OWNER';
    
    const isSlash = text.startsWith('/');
    const isArithmetic = SafeMath.isArithmeticShorthand(text);
    const isShortCircuit = isSlash || (isArithmetic && (actorRole === 'OWNER' || actorRole === 'STAFF'));

    expect(isShortCircuit).toBe(true);
  });

  it('Owner sending plain 74.5 is classified as calculator shorthand and short-circuits', () => {
    const text = '74.5';
    const actorRole: string = 'STAFF';
    
    const isSlash = text.startsWith('/');
    const isArithmetic = SafeMath.isArithmeticShorthand(text);
    const isShortCircuit = isSlash || (isArithmetic && (actorRole === 'OWNER' || actorRole === 'STAFF'));

    expect(isShortCircuit).toBe(true);
  });

  it('Customer sending plain 78 does NOT short-circuit to calculator', () => {
    const text = '78';
    const actorRole: string = 'CUSTOMER';
    
    const isSlash = text.startsWith('/');
    const isArithmetic = SafeMath.isArithmeticShorthand(text);
    const isShortCircuit = isSlash || (isArithmetic && (actorRole === 'OWNER' || actorRole === 'STAFF'));

    expect(isShortCircuit).toBe(false);
  });

  it('Owner sending image with caption +67 is classified as calculator shorthand and short-circuits', () => {
    const rawText: string = '';
    const rawCaption: string = '+67';
    const actorRole: string = 'OWNER';
    const isOwnerOrStaff = actorRole === 'OWNER' || actorRole === 'STAFF';

    let isShortCircuit = false;
    if (rawText) {
      if (rawText.startsWith('/') || (SafeMath.isArithmeticShorthand(rawText) && isOwnerOrStaff)) {
        isShortCircuit = true;
      }
    }
    if (!isShortCircuit && rawCaption && isOwnerOrStaff) {
      if (rawCaption.startsWith('/') || SafeMath.isArithmeticShorthand(rawCaption)) {
        isShortCircuit = true;
      }
    }

    expect(isShortCircuit).toBe(true);
  });

  it('Customer sending image with caption +67 does NOT short-circuit to calculator and does not hijack payment', () => {
    const rawText: string = '';
    const rawCaption: string = '+67';
    const actorRole: string = 'CUSTOMER';
    const isOwnerOrStaff = actorRole === 'OWNER' || actorRole === 'STAFF';

    let isShortCircuit = false;
    if (rawText) {
      if (rawText.startsWith('/') || (SafeMath.isArithmeticShorthand(rawText) && isOwnerOrStaff)) {
        isShortCircuit = true;
      }
    }
    if (!isShortCircuit && rawCaption && isOwnerOrStaff) {
      if (rawCaption.startsWith('/') || SafeMath.isArithmeticShorthand(rawCaption)) {
        isShortCircuit = true;
      }
    }

    expect(isShortCircuit).toBe(false);
  });

  it('Real order text does not short-circuit and reaches order parser', () => {
    const text = '100 CP Facebook';
    const actorRole: string = 'CUSTOMER';
    
    const isSlash = text.startsWith('/');
    const isArithmetic = SafeMath.isArithmeticShorthand(text);
    const isShortCircuit = isSlash || (isArithmetic && (actorRole === 'OWNER' || actorRole === 'STAFF'));

    expect(isShortCircuit).toBe(false);
  });
});
