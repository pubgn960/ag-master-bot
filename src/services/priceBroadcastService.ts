/**
 * @deprecated Global mass price broadcast has been deprecated and unlinked
 * to protect customer groups from unintended mass messaging and to prevent
 * active promotional pins from being unpinned.
 *
 * Promotional broadcasts are now dispatched selectively from the Promotions dashboard.
 */

export interface DeprecatedPriceBroadcastResult {
  disabled: boolean;
  message: string;
}

export async function createAndSendPriceBroadcast(): Promise<DeprecatedPriceBroadcastResult> {
  console.warn('[DEPRECATION NOTICE] Global price broadcasting is disabled.');
  return {
    disabled: true,
    message: 'Global mass price broadcast is deprecated and unlinked to protect group pins.',
  };
}

export default {
  createAndSendPriceBroadcast,
};
