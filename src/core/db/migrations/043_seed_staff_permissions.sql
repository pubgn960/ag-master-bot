-- Migration 043: Seed complete staff dashboard permissions
INSERT INTO permissions (id, category, description) VALUES
    -- Orders & Fulfillment
    ('VIEW_ORDERS', 'ORDER', 'View Orders'),
    ('PROCESS_ORDER', 'ORDER', 'Process Order'),
    ('UNDO_PROCESS_ORDER', 'ORDER', 'Undo Process Order'),
    ('CANCEL_ORDER', 'ORDER', 'Cancel Order'),
    ('UNDO_CANCEL_ORDER', 'ORDER', 'Undo Cancel Order'),
    ('DISPATCH_ORDER', 'ORDER', 'Dispatch Order'),
    ('RESEND_LOADER_DELIVERY', 'ORDER', 'Resend Loader Delivery'),
    ('REVEAL_ORDER_CREDENTIALS', 'ORDER', 'Reveal Order Credentials'),

    -- Payments & Credit
    ('VIEW_PAYMENTS', 'PAYMENT', 'View Payments'),
    ('VERIFY_PAYMENT', 'PAYMENT', 'Verify Payment'),
    ('MANUAL_MARK_PAID', 'PAYMENT', 'Manual Mark Paid'),
    ('MANUAL_MARK_UNPAID', 'PAYMENT', 'Manual Mark Unpaid'),
    ('ALLOCATE_PAYMENT', 'PAYMENT', 'Allocate Payment'),
    ('REVERSE_PAYMENT', 'PAYMENT', 'Reverse Payment'),
    ('VIEW_CUSTOMER_CREDIT', 'PAYMENT', 'View Customer Credit'),
    ('APPLY_CUSTOMER_CREDIT', 'PAYMENT', 'Apply Customer Credit'),
    ('ADJUST_CUSTOMER_CREDIT', 'PAYMENT', 'Adjust Customer Credit'),
    ('MANAGE_CUSTOMER_CREDIT', 'PAYMENT', 'Manage Customer Credit'),

    -- Pricing & Promotions
    ('VIEW_SALE_PRICES', 'PRICING', 'View Sale Prices'),
    ('EDIT_SALE_PRICE', 'PRICING', 'Edit Sale Price'),
    ('BULK_EDIT_SALE_PRICES', 'PRICING', 'Bulk Edit Sale Prices'),
    ('VIEW_LOADER_COSTS', 'PRICING', 'View Loader Costs'),
    ('EDIT_LOADER_COST', 'PRICING', 'Edit Loader Cost'),
    ('BULK_EDIT_LOADER_COSTS', 'PRICING', 'Bulk Edit Loader Costs'),
    ('PREVIEW_AUTO_PRICING', 'PRICING', 'Preview Auto Pricing'),
    ('CONFIRM_AUTO_PRICING', 'PRICING', 'Confirm Auto Pricing'),
    ('CREATE_PROMOTION', 'PRICING', 'Create Promotion'),
    ('EDIT_PROMOTION', 'PRICING', 'Edit Promotion'),
    ('CHANGE_PROMOTION_STATUS', 'PRICING', 'Change Promotion Status'),

    -- Configuration
    ('VIEW_GROUPS', 'CONFIGURATION', 'View Groups'),
    ('ADD_GROUP', 'CONFIGURATION', 'Add Group'),
    ('EDIT_GROUP', 'CONFIGURATION', 'Edit Group'),
    ('BIND_GROUP_TELEGRAM_ID', 'CONFIGURATION', 'Bind Group Telegram ID'),
    ('CHANGE_GROUP_ROUTING', 'CONFIGURATION', 'Change Group Routing'),
    ('VIEW_LOADERS', 'CONFIGURATION', 'View Loaders'),
    ('ADD_LOADER', 'CONFIGURATION', 'Add Loader'),
    ('EDIT_LOADER', 'CONFIGURATION', 'Edit Loader'),
    ('CHANGE_LOADER_STATUS', 'CONFIGURATION', 'Change Loader Status'),
    ('VIEW_PAYMENT_PROFILES', 'CONFIGURATION', 'View Payment Profiles'),
    ('EDIT_PAYMENT_PROFILES', 'CONFIGURATION', 'Edit Payment Profiles'),
    ('VIEW_TEMPLATES', 'CONFIGURATION', 'View Templates'),
    ('EDIT_TEMPLATES', 'CONFIGURATION', 'Edit Templates'),

    -- System & Admin
    ('CREATE_BROADCAST_DRAFT', 'SYSTEM', 'Create Broadcast Draft'),
    ('PREVIEW_BROADCAST', 'SYSTEM', 'Preview Broadcast'),
    ('SEND_BROADCAST', 'SYSTEM', 'Send Broadcast'),
    ('VIEW_PROFIT', 'SYSTEM', 'View Profit'),
    ('VIEW_AUDIT_LOG', 'SYSTEM', 'View Audit Log'),
    ('RUN_RECONCILIATION', 'SYSTEM', 'Run Reconciliation'),
    ('RESOLVE_RECONCILIATION', 'SYSTEM', 'Resolve Reconciliation'),
    ('VIEW_INTEGRATIONS', 'SYSTEM', 'View Integrations'),
    ('MANAGE_INTEGRATIONS', 'SYSTEM', 'Manage Integrations'),
    ('VIEW_FEATURE_FLAGS', 'SYSTEM', 'View Feature Flags'),
    ('MANAGE_FEATURE_FLAGS', 'SYSTEM', 'Manage Feature Flags'),
    ('VIEW_STAFF', 'SYSTEM', 'View Staff'),
    ('ADD_STAFF', 'SYSTEM', 'Add Staff'),
    ('EDIT_STAFF_PERMISSIONS', 'SYSTEM', 'Edit Staff Permissions'),
    ('DEACTIVATE_STAFF', 'SYSTEM', 'Deactivate Staff')
ON CONFLICT (id) DO NOTHING;
