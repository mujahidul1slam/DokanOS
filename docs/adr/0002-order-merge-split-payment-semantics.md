# Preserve payment meaning across order merge and split

Orders may be merged only before courier entry; merging combines the source orders' items and payment records. Splitting creates independent orders, and the split flow must distinguish COD, newly collected payment, and payment transferred from the original so existing money is never silently duplicated; delivery and other order charges are included in the allocation.
