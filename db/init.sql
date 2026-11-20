CREATE TABLE orders (
  id serial PRIMARY KEY,
  customer text,
  status text,
  total numeric
);

ALTER TABLE orders REPLICA IDENTITY FULL;

INSERT INTO orders (customer, status, total) VALUES
  ('Maya', 'pending', 40),
  ('Dev', 'pending', 25),
  ('Sana', 'shipped', 90);
