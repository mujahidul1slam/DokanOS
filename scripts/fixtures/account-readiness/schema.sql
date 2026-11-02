-- Only for a newly created, disposable PostgreSQL database; never apply to deployed data.
CREATE SCHEMA auth;
CREATE TABLE auth.users (id text PRIMARY KEY);
CREATE TABLE businesses (id text PRIMARY KEY);
CREATE TABLE user_business_access (
  id text PRIMARY KEY, user_id text REFERENCES auth.users(id), business_id text REFERENCES businesses(id), role text
);
CREATE TABLE stores (id text PRIMARY KEY, consumer_secret text);
CREATE TABLE brands (id text PRIMARY KEY, business_id text REFERENCES businesses(id), woo_store_id text REFERENCES stores(id));
CREATE TABLE storefronts (id text PRIMARY KEY, brand_id text REFERENCES brands(id), store_id text);
CREATE TABLE locations (id text PRIMARY KEY, business_id text REFERENCES businesses(id), brand_id text REFERENCES brands(id), type text);
CREATE TABLE selling_points (
  id text PRIMARY KEY, business_id text REFERENCES businesses(id), brand_id text REFERENCES brands(id), type text,
  location_id text REFERENCES locations(id), woo_store_id text REFERENCES stores(id), storefront_id text REFERENCES storefronts(id)
);
CREATE TABLE user_roles (id text PRIMARY KEY, user_id text REFERENCES auth.users(id), role text);
CREATE TABLE user_permissions (id text PRIMARY KEY, user_id text REFERENCES auth.users(id), permission text, granted boolean);
CREATE TABLE user_store_access (id text PRIMARY KEY, user_id text REFERENCES auth.users(id), store_id text REFERENCES stores(id));
CREATE TABLE custom_roles (id text PRIMARY KEY, permissions text[]);
CREATE TABLE user_custom_roles (id text PRIMARY KEY, user_id text REFERENCES auth.users(id), custom_role_id text REFERENCES custom_roles(id));
CREATE TABLE permission_settings (id text PRIMARY KEY, enforce_store_scoping boolean);
CREATE TABLE invitations (id text PRIMARY KEY, role text, accepted_at timestamptz);
CREATE TABLE orders (id text PRIMARY KEY, store_id text REFERENCES stores(id), notes text);
CREATE TABLE order_items (id text PRIMARY KEY, order_id text REFERENCES orders(id));
INSERT INTO auth.users VALUES ('owner'), ('member');
INSERT INTO businesses VALUES ('account');
INSERT INTO user_business_access VALUES ('owner-membership', 'owner', 'account', 'owner'), ('member-membership', 'member', 'account', 'member');
INSERT INTO stores VALUES ('woo', 'fixture-secret-do-not-export');
INSERT INTO brands VALUES ('brand', 'account', 'woo');
INSERT INTO orders VALUES ('order', 'woo', 'original history');
INSERT INTO order_items VALUES ('item', 'order');
