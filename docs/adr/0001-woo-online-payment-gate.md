# Gate WooCommerce online-payment orders before courier entry

WooCommerce orders whose online payment is not confirmed must remain in Payment Needs Confirmation and cannot be entered with a courier or advanced by ordinary status changes. Manual, POS, and COD orders are outside this gate; payment confirmation is a permission-controlled manual action, and the existing Payment Pending storage value is renamed only at the display layer to avoid a WooCommerce migration.
