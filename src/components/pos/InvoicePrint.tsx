import type { Cart } from "./types";
import type { InvoiceSettings } from "@/hooks/useInvoiceSettings";

interface InvoiceData {
  orderNumber: string;
  cart: Cart;
  subtotal: number;
  total: number;
  invoiceSettings?: InvoiceSettings;
}

export const printInvoice = (data: InvoiceData, format: "thermal" | "a4") => {
  const { orderNumber, cart, subtotal, total, invoiceSettings } = data;
  const discount = cart.discount || 0;
  const shipping = cart.fulfillment === "delivery" ? cart.shippingFee : 0;
  const now = new Date();

  const biz = invoiceSettings || {
    business_name: "OmniSync",
    tagline: "",
    address: "",
    phone: "",
    email: "",
    logo_url: "",
    footer_text: "Thank you for shopping with us!",
    terms_text: "",
  };

  const customerBlock = cart.customer
    ? `
      <div style="margin-bottom:12px;">
        <strong>Customer:</strong> ${cart.customer.name}<br/>
        ${cart.customer.phone ? `<strong>Phone:</strong> ${cart.customer.phone}<br/>` : ""}
        ${cart.customer.address ? `<strong>Address:</strong> ${cart.customer.address}<br/>` : ""}
        ${cart.customer.city ? `${cart.customer.city}` : ""}${cart.customer.zone ? `, ${cart.customer.zone}` : ""}
      </div>
    `
    : "";

  const itemsRows = cart.items
    .map(
      (i) => `
      <tr>
        <td style="padding:4px 2px;border-bottom:1px solid #eee;font-size:${format === "thermal" ? "11px" : "13px"};">
          ${i.name}${i.variationLabel ? ` <span style="color:#888;">- ${i.variationLabel}</span>` : ""}
          ${i.customTailoring ? ' <span style="color:#3b82f6;font-size:10px;">[Custom]</span>' : ""}
        </td>
        <td style="padding:4px 2px;border-bottom:1px solid #eee;text-align:center;">${i.qty}</td>
        <td style="padding:4px 2px;border-bottom:1px solid #eee;text-align:right;">৳${Number(i.price).toLocaleString()}</td>
        <td style="padding:4px 2px;border-bottom:1px solid #eee;text-align:right;">৳${(i.price * i.qty).toLocaleString()}</td>
      </tr>`
    )
    .join("");

  const paymentsBlock =
    cart.payments.length > 0
      ? `
      <div style="margin-top:8px;font-size:${format === "thermal" ? "11px" : "12px"};">
        <strong>Payments:</strong><br/>
        ${cart.payments.map((p) => `${p.method.toUpperCase()}: ৳${p.amount.toLocaleString()}`).join("<br/>")}
      </div>
    `
      : "";

  const width = format === "thermal" ? "280px" : "210mm";
  const fontSize = format === "thermal" ? "12px" : "14px";

  const logoHtml = biz.logo_url
    ? `<img src="${biz.logo_url}" alt="Logo" style="max-height:${format === "thermal" ? "40px" : "60px"};max-width:${format === "thermal" ? "120px" : "180px"};object-fit:contain;margin:0 auto 6px;" />`
    : "";

  const contactLine = [biz.phone, biz.email].filter(Boolean).join(" | ");
  const addressBlock = biz.address ? `<p class="meta" style="margin:2px 0;">${biz.address}</p>` : "";
  const contactBlock = contactLine ? `<p class="meta" style="margin:2px 0;">${contactLine}</p>` : "";

  const termsBlock = biz.terms_text
    ? `<div style="margin-top:12px;padding-top:8px;border-top:1px solid #ddd;font-size:${format === "thermal" ? "9px" : "10px"};color:#888;">
        <strong>Terms & Conditions:</strong><br/>${biz.terms_text}
      </div>`
    : "";

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Invoice - ${orderNumber}</title>
      <style>
        @page { size: ${format === "thermal" ? "80mm auto" : "A4"}; margin: ${format === "thermal" ? "4mm" : "15mm"}; }
        body { font-family: 'Segoe UI', Arial, sans-serif; font-size: ${fontSize}; color: #111; margin: 0; padding: 0; }
        .invoice { max-width: ${width}; margin: 0 auto; padding: ${format === "thermal" ? "8px" : "24px"}; }
        table { width: 100%; border-collapse: collapse; }
        th { text-align: left; padding: 4px 2px; border-bottom: 2px solid #333; font-size: ${format === "thermal" ? "11px" : "13px"}; }
        .total-row td { font-weight: bold; padding-top: 8px; border-top: 2px solid #333; }
        .header { text-align: center; margin-bottom: 12px; }
        .header h1 { margin: 0; font-size: ${format === "thermal" ? "16px" : "22px"}; }
        .meta { color: #666; font-size: ${format === "thermal" ? "10px" : "12px"}; }
        .footer { text-align: center; margin-top: 16px; font-size: ${format === "thermal" ? "10px" : "11px"}; color: #888; }
      </style>
    </head>
    <body>
      <div class="invoice">
        <div class="header">
          ${logoHtml}
          <h1>${biz.business_name}</h1>
          ${biz.tagline ? `<p class="meta">${biz.tagline}</p>` : ""}
          ${addressBlock}
          ${contactBlock}
        </div>

        <div style="margin-bottom:12px;">
          <strong>Invoice:</strong> ${orderNumber}<br/>
          <span class="meta">Date: ${now.toLocaleDateString()} ${now.toLocaleTimeString()}</span><br/>
          <span class="meta">Fulfillment: ${cart.fulfillment === "delivery" ? "Home Delivery" : cart.fulfillment === "pickup" ? "Shop Pickup" : "Walk-In"}</span>
        </div>

        ${customerBlock}

        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th style="text-align:center;">Qty</th>
              <th style="text-align:right;">Price</th>
              <th style="text-align:right;">Total</th>
            </tr>
          </thead>
          <tbody>
            ${itemsRows}
          </tbody>
        </table>

        <div style="text-align:right;margin-top:12px;">
          <div>Subtotal: ৳${subtotal.toLocaleString()}</div>
          ${discount > 0 ? `<div>Discount: -৳${discount.toLocaleString()}</div>` : ""}
          ${shipping > 0 ? `<div>Shipping: ৳${shipping.toLocaleString()}</div>` : ""}
          <div style="font-size:${format === "thermal" ? "14px" : "18px"};font-weight:bold;margin-top:4px;border-top:2px solid #333;padding-top:4px;">
            Total: ৳${total.toLocaleString()}
          </div>
        </div>

        ${paymentsBlock}

        ${cart.notes ? `<div style="margin-top:8px;font-size:11px;"><strong>Notes:</strong> ${cart.notes}</div>` : ""}

        ${termsBlock}

        <div class="footer">
          ${biz.footer_text || "Thank you for shopping with us!"}
        </div>
      </div>
    </body>
    </html>
  `;

  const printWindow = window.open("", "_blank", "width=800,height=600");
  if (printWindow) {
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 300);
  }
};
