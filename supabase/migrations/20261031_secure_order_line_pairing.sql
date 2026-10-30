-- Prevent someone who merely guesses a sequential order ID from claiming the LINE order.
-- Only the hash of the random pairing token is persisted.
alter table public.website_orders
  add column if not exists line_link_token_hash text;
