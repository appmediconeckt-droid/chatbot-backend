// Real payment capture is unavailable in this demonstration build.
export const creditCapturedWalletPayment = async () => {
  const error = new Error(
    "Real payments are disabled. Demo funds are not redeemable."
  );
  error.code = "REAL_PAYMENTS_DISABLED";
  throw error;
};
