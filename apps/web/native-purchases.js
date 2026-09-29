(function () {
  const products = new Map();

  function plugin() {
    return window.Capacitor?.Plugins?.SwarmStore;
  }

  window.SwarmPurchases = {
    isNative: Boolean(window.SwarmRuntime?.native),
    available() {
      return Boolean(window.SwarmRuntime?.native && plugin());
    },
    async loadProducts(offers) {
      if (!this.available()) return;
      const result = await plugin().getProducts({ productIds: offers.map(offer => offer.appleProductId) });
      products.clear();
      for (const product of result.products ?? []) products.set(product.id, product);
    },
    product(offer) {
      return products.get(offer.appleProductId);
    },
    async purchase(offer, accessToken) {
      if (!this.available()) throw new Error('Apple ödeme sistemi bu cihazda kullanılamıyor.');
      const transaction = await plugin().purchase({ productId: offer.appleProductId });
      const response = await fetch(window.SwarmRuntime.apiUrl('/api/v1/payments/apple/complete'), {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          offerId: offer.id,
          productId: transaction.productId,
          transactionId: transaction.transactionId,
          signedTransaction: transaction.verificationResult
        })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || result.message || 'Satın alma sunucuda doğrulanamadı.');
      await plugin().finishTransaction({ transactionId: transaction.transactionId });
      return result;
    }
  };
})();
