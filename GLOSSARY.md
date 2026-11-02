# Business Organization

The language used to distinguish personal accounts, business accounts, and their brands and stores.

## Language

**Personal account**:
A person's individual identity and login. A personal account can belong to multiple business accounts.
_Avoid_: Business account (when referring to a person's identity)

**Business account**:
A shared business workspace containing brands, stores, and other business resources. Multiple personal accounts can belong to a business account.
_Avoid_: Fusion business account, umbrella account

**Brand**:
A commercial identity belonging to a business account, independent of any online store or storefront.

**Store**:
A selling operation belonging to exactly one brand, with its own staff access and module permissions. Each store is either physical or online, not both; a brand can have multiple stores or none.
_Avoid_: Storefront (when referring to the entire selling operation)

**Account owner**:
A person with full authority over a business account and its resources, whose access cannot be restricted. Ownership must be transferred before the owner can leave the business account.

**Invited person**:
A person granted access to a business account or specific resources within it. Joining by invitation does not require owning a separate business account.

**Inherited access**:
Access to child resources received through access to their parent, subject to explicit restrictions on individual children or their modules. Explicit restrictions take precedence over inherited grants.

**All-store access**:
Brand access covering all current and future stores under that brand, subject to explicit restrictions.

**Selected-store access**:
Brand access covering only explicitly selected stores, subject to explicit restrictions; new stores are not automatically included.

**Action permission**:
Permission to perform a particular action within a module, distinct from permission to view that module's information.

# Ordering

The language used when taking, paying for, entering, and combining customer orders.

## Language

**Entered**:
An order booked with a courier, holding an active consignment. A cancelled booking returns the order to not-entered; past consignments stay in the order's history.
_Avoid_: Shipped, dispatched (when meaning the booking act)

**Consignment**:
A single parcel booking with a courier, identified by a number the courier issued. An order can hold several over its life, one active at most.
_Avoid_: Courier entry, parcel

**Payment Needs Confirmation**:
The state of an order whose payment was promised online but not yet recorded as received. Such an order cannot be entered with a courier or moved to another status.
_Avoid_: Payment Pending

**Payment confirmation**:
The act of recording that an order's promised payment has been received. It is the only way an order leaves the Payment Needs Confirmation state.

**Duplicate order**:
A newly-taken order matching a recent order by the same customer and at least one product of the same brand. Stores and selling points may differ.

**Merge**:
Combining two or more not-entered orders of the same customer into a single order that takes all their items and payments.
_Avoid_: Combine, group

**Split**:
Dividing an order into two independent orders. The original keeps its payment records; the new order's payment is assigned during the split.

**Pathao account**:
The Pathao merchant account used to dispatch an order. It determines the courier credentials and pickup configuration used for that dispatch.
_Avoid_: Pathao store

**Selling point**:
A place or channel where a brand sells, such as a showroom, Facebook page, or online storefront. An order belongs to one selling point for operational attribution.
_Avoid_: Store (in user-facing copy when it would be confused with a Pathao account)

**Courier integration**:
A configured connection between DokanOS and a courier account, used to create, cancel, track, and replace consignments.

**Pickup slip**:
A printable document that travels with an order and identifies the customer, order contents, charges, brand, selling point, and courier dispatch information.

**Measurement slip**:
A printable document that carries an order's product and measurement information for production or fitting.
