-- Migration 031: Add loader_settled column to orders
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS loader_settled BOOLEAN NOT NULL DEFAULT FALSE;
