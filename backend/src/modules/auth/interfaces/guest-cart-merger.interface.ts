export const GUEST_CART_MERGER = 'GUEST_CART_MERGER';

export interface GuestCartMergeParams {
  tenantId: string;
  customerId: string;
  guestToken: string;
}

export interface GuestCartMerger {
  mergeGuestCartOnLogin(params: GuestCartMergeParams): Promise<void>;
}
