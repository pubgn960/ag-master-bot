-- Migration 032: Add last_reminder_sent_at column to orders
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS last_reminder_sent_at TIMESTAMP WITH TIME ZONE;
