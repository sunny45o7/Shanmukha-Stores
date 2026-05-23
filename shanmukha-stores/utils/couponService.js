const normalizeCouponCode = (code) => (code || "").trim().toUpperCase();

const normalizeIdList = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((v) => Number(v))
      .filter((v) => Number.isInteger(v) && v > 0);
  }
  if (typeof value === "string") {
    return value
      .replace(/[{}]/g, "")
      .split(",")
      .map((v) => Number(String(v).trim()))
      .filter((v) => Number.isInteger(v) && v > 0);
  }
  return [];
};

const getCouponByCode = async (client, code, { lock = false } = {}) => {
  const normalized = normalizeCouponCode(code);
  if (!normalized) return null;

  const lockClause = lock ? " FOR UPDATE" : "";
  const result = await client.query(
    `SELECT *
     FROM coupons
     WHERE UPPER(code) = UPPER($1)
       AND is_active = true
       AND (starts_at IS NULL OR starts_at <= NOW())
       AND (ends_at IS NULL OR ends_at >= NOW())
     LIMIT 1${lockClause}`,
    [normalized]
  );
  return result.rows[0] || null;
};

const calculateCouponDiscount = ({ subtotal, coupon }) => {
  const amount = Number(subtotal || 0);
  if (!coupon || amount <= 0) return 0;

  let discount = 0;
  const value = Number(coupon.discount_value || 0);
  if (coupon.discount_type === "percent") {
    discount = (amount * value) / 100;
    const cap = Number(coupon.max_discount || 0);
    if (cap > 0) discount = Math.min(discount, cap);
  } else {
    discount = value;
  }

  return Math.max(0, Math.min(discount, amount));
};

const getUserCouponUsageCount = async (client, couponId, userId) => {
  const result = await client.query(
    "SELECT COUNT(*)::int AS count FROM coupon_usages WHERE coupon_id = $1 AND user_id = $2",
    [couponId, userId]
  );
  return Number(result.rows[0]?.count || 0);
};

const getItemSubtotal = (item) => {
  if (!item) return 0;
  const directSubtotal = Number(item.subtotal);
  if (!Number.isNaN(directSubtotal) && directSubtotal > 0) return directSubtotal;

  const price = Number(item.price || 0);
  const quantity = Number(item.quantity || 1);
  return Math.max(0, price * (quantity > 0 ? quantity : 1));
};

const validateCouponForUser = async ({ client, code, subtotal, userId, cartItems = [], lock = false }) => {
  const normalized = normalizeCouponCode(code);
  if (!normalized) return { ok: false, code: "", error: "Please enter a coupon code." };

  const coupon = await getCouponByCode(client, normalized, { lock });
  if (!coupon) {
    return { ok: false, code: normalized, error: "Invalid or expired coupon code." };
  }

  const productRestrictions = normalizeIdList(coupon.applicable_product_ids);
  const categoryRestrictions = normalizeIdList(coupon.applicable_category_ids);
  const hasRestrictions = productRestrictions.length > 0 || categoryRestrictions.length > 0;

  let effectiveSubtotal = Number(subtotal || 0);
  if ((!effectiveSubtotal || Number.isNaN(effectiveSubtotal)) && Array.isArray(cartItems) && cartItems.length > 0) {
    effectiveSubtotal = cartItems.reduce((sum, item) => sum + getItemSubtotal(item), 0);
  }

  if (hasRestrictions) {
    if (!Array.isArray(cartItems) || cartItems.length === 0) {
      return {
        ok: false,
        code: normalized,
        coupon,
        error: "Coupon is restricted to selected products/categories.",
      };
    }

    const applicableItems = cartItems.filter((item) => {
      const productId = Number(item.product_id || item.id || 0);
      const categoryId = Number(item.category_id || 0);
      return productRestrictions.includes(productId) || categoryRestrictions.includes(categoryId);
    });

    effectiveSubtotal = applicableItems.reduce((sum, item) => sum + getItemSubtotal(item), 0);
    if (effectiveSubtotal <= 0) {
      return {
        ok: false,
        code: normalized,
        coupon,
        error: "Coupon is not applicable for selected products/categories.",
      };
    }
  }

  const minOrder = Number(coupon.min_order_amount || 0);
  if (effectiveSubtotal < minOrder) {
    return {
      ok: false,
      code: normalized,
      coupon,
      error: `Minimum order for this coupon is Rs ${minOrder.toLocaleString("en-IN")}.`,
    };
  }

  const usageLimit = Number(coupon.usage_limit || 0);
  const usedCount = Number(coupon.used_count || 0);
  if (usageLimit > 0 && usedCount >= usageLimit) {
    return { ok: false, code: normalized, coupon, error: "Coupon usage limit reached." };
  }

  const perUserLimit = 1;
  if (userId) {
    const userUsed = await getUserCouponUsageCount(client, coupon.id, userId);
    if (userUsed >= perUserLimit) {
      return { ok: false, code: normalized, coupon, error: "You have already used this coupon." };
    }
  }

  const discount = calculateCouponDiscount({ subtotal: effectiveSubtotal, coupon });
  if (discount <= 0) {
    return { ok: false, code: normalized, coupon, error: "Coupon is not applicable for this order." };
  }

  return { ok: true, code: normalized, coupon, discount, applicableSubtotal: effectiveSubtotal };
};

module.exports = {
  normalizeCouponCode,
  calculateCouponDiscount,
  validateCouponForUser,
};
