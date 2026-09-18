import React, { useState, useEffect } from 'react';
import { NavItemKey } from './components/Sidebar';
import { Layout } from './components/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';

// Views
import { OverviewView } from './views/OverviewView';
import { PendingOrdersView } from './views/PendingOrdersView';
import { OrdersView } from './views/OrdersView';
import { PartialPaymentsView } from './views/PartialPaymentsView';
import { PaymentsView } from './views/PaymentsView';
import { CustomersGroupsView } from './views/CustomersGroupsView';
import { ProductsView } from './views/ProductsView';
import { CPBundlesView } from './views/CPBundlesView';
import { LoadersView } from './views/LoadersView';
import { RoutingView } from './views/RoutingView';
import { LoaderPricesView } from './views/LoaderPricesView';
import { PriceProfilesView } from './views/PriceProfilesView';
import { CurrentPricesView } from './views/CurrentPricesView';
import { PromotionsView } from './views/PromotionsView';
import { PricingHealthView } from './views/PricingHealthView';
import { ProfitLossView } from './views/ProfitLossView';
import { ReportsView } from './views/ReportsView';
import { PaymentProfilesView } from './views/PaymentProfilesView';
import { BroadcastsView } from './views/BroadcastsView';
import { StaffView } from './views/StaffView';
import { TemplatesView } from './views/TemplatesView';
import { ReconciliationView } from './views/ReconciliationView';
import { AuditLogsView } from './views/AuditLogsView';
import { SettingsView } from './views/SettingsView';
import { BotCommandsView } from './views/BotCommandsView';

export default function App() {
  const [activeTab, setActiveTab] = useState<NavItemKey>(() => {
    if (typeof window !== 'undefined') {
      const hash = window.location.hash.replace('#', '');
      const path = window.location.pathname.replace(/^\//, '');
      if (hash === 'reports' || path === 'reports') return 'reports';
      if (hash === 'profit' || hash === 'profit-loss' || path === 'profit') return 'profit-loss';
    }
    return 'overview';
  });
  const [systemMode, setSystemMode] = useState<'NORMAL' | 'SAFE_MODE' | 'READ_ONLY'>('NORMAL');
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    // Fetch initial persisted operational mode
    fetch('/api/settings/mode')
      .then((r) => r.json())
      .then((d) => {
        if (d && d.mode) setSystemMode(d.mode);
      })
      .catch(() => {});

    // Poll pending orders count
    const updateCounts = () => {
      fetch('/api/orders?status=PENDING')
        .then((r) => r.json())
        .then((data) => {
          if (Array.isArray(data)) setPendingCount(data.length);
        })
        .catch(() => {});
    };

    updateCounts();
    const interval = setInterval(updateCounts, 10000);
    return () => clearInterval(interval);
  }, []);

  const renderActiveView = () => {
    switch (activeTab) {
      case 'overview':
        return <OverviewView onNavigate={setActiveTab} />;
      case 'pending-orders':
        return <PendingOrdersView />;
      case 'orders':
        return <OrdersView />;
      case 'partial-payments':
        return <PartialPaymentsView />;
      case 'payments':
        return <PaymentsView />;
      case 'customers':
        return <CustomersGroupsView />;
      case 'products': return <ProductsView />;
      case 'cp-bundles': return <CPBundlesView />;
      case 'loaders':
        return <LoadersView />;
      case 'routing':
        return <RoutingView />;
      case 'loader-prices':
        return <LoaderPricesView />;
      case 'price-profiles':
        return <PriceProfilesView />;
      case 'current-prices':
        return <CurrentPricesView />;
      case 'promotions':
        return <PromotionsView />;
      case 'pricing-health':
        return <PricingHealthView />;
      case 'reports':
        return <ReportsView onOpenProfitLedger={() => setActiveTab('profit-loss')} onNavigate={setActiveTab} />;
      case 'profit-loss':
        return <ProfitLossView onBack={() => setActiveTab('reports')} />;
      case 'payment-profiles':
        return <PaymentProfilesView />;
      case 'broadcasts':
        return <BroadcastsView />;
      case 'staff':
        return <StaffView />;
      case 'templates':
        return <TemplatesView />;
      case 'reconciliation':
        return <ReconciliationView />;
      case 'audit':
        return <AuditLogsView />;
      case 'bot-commands':
        return <BotCommandsView />;
      case 'settings':
        return <SettingsView currentMode={systemMode} onModeChange={setSystemMode} />;
      default:
        return <OverviewView onNavigate={setActiveTab} />;
    }
  };

  return (
    <Layout
      activeTab={activeTab}
      onSelectTab={setActiveTab}
      pendingCount={pendingCount}
      systemMode={systemMode}
    >
      <ErrorBoundary key={activeTab} fallbackTitle={`Failed to load ${activeTab} view`}>
        {renderActiveView()}
      </ErrorBoundary>
    </Layout>
  );
}
