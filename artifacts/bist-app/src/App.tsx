import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import React from "react";

import { AuthProvider, useAuth } from "@/lib/auth-context";

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, fontFamily: "monospace", direction: "ltr", background: "#fff", color: "#c00", minHeight: "100vh" }}>
          <h2>⚠️ App crashed</h2>
          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
            {this.state.error.message}
            {"\n\n"}
            {this.state.error.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

import Dashboard from "@/pages/dashboard";
import Leads from "@/pages/leads";
import Customers from "@/pages/customers";
import Products from "@/pages/products";
import Components from "@/pages/components";
import Quotes from "@/pages/quotes";
import QuotesNew from "@/pages/quotes-new";
import QuotesDetail from "@/pages/quotes-detail";
import Deals from "@/pages/deals";
import DealsDetail from "@/pages/deals-detail";
import Production from "@/pages/production";
import WhatsApp from "@/pages/whatsapp";
import WhatsAppAnalytics from "@/pages/whatsapp-analytics";
import Tasks from "@/pages/tasks";
import Settings from "@/pages/settings";
import QuotePdfTemplate from "@/pages/quote-pdf-template";
import MondaySettings from "@/pages/monday-settings";
import MondayRunDetail from "@/pages/monday-run-detail";
import VatAudit from "@/pages/vat-audit";
import Login from "@/pages/login";
import NotFound from "@/pages/not-found";
import SignPage from "@/pages/sign";
import PayPage from "@/pages/pay";
import PaymentDone from "@/pages/payment-done";
import CrmLeads from "@/pages/crm/leads";
import CrmLeadDetail from "@/pages/crm/lead-detail";
import CrmFunnels from "@/pages/crm/funnels";
import CrmAds from "@/pages/crm/ads";
import CrmAvailability from "@/pages/crm/availability";
import { TaskNudgeProvider } from "@/components/crm/task-nudge-provider";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 3 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function AuthGate({ children }: { children: React.ReactNode }) {
  const { session, appUser, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground text-sm">טוען...</p>
      </div>
    );
  }

  if (!session || !appUser) {
    return <Login />;
  }

  return <>{children}</>;
}

function Router() {
  return (
    <Switch>
      <Route path="/">{() => { window.location.replace("/leads"); return null; }}</Route>
      <Route path="/crm/leads" component={CrmLeads} />
      <Route path="/crm/availability" component={CrmAvailability} />
      <Route path="/crm/funnels" component={CrmFunnels} />
      <Route path="/crm/ads" component={CrmAds} />
      <Route path="/crm/leads/:id" component={CrmLeadDetail} />
      <Route path="/leads" component={Leads} />
      <Route path="/customers" component={Customers} />
      <Route path="/products" component={Products} />
      <Route path="/components" component={Components} />
      <Route path="/quotes/new">{() => <QuotesNew />}</Route>
      <Route path="/quotes/:id/duplicate">
        {(params: { id: string }) => <QuotesNew sourceQuoteId={params.id} />}
      </Route>
      <Route path="/quotes/:id" component={QuotesDetail} />
      <Route path="/quotes" component={Quotes} />
      <Route path="/deals/:id" component={DealsDetail} />
      <Route path="/deals" component={Deals} />
      <Route path="/production/analytics" component={WhatsAppAnalytics} />
      <Route path="/production" component={WhatsApp} />
      <Route path="/tasks" component={Tasks} />
      <Route path="/settings/quote-pdf-template" component={QuotePdfTemplate} />
      <Route path="/settings/monday/runs/:id" component={MondayRunDetail} />
      <Route path="/settings/monday" component={MondaySettings} />
      <Route path="/settings/vat-audit" component={VatAudit} />
      <Route path="/settings" component={Settings} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <AuthProvider>
              <Switch>
                {/* עמודים ציבוריים — ללא התחברות */}
                <Route path="/sign/:token" component={SignPage} />
                <Route path="/pay/:token" component={PayPage} />
                <Route path="/payment-done" component={PaymentDone} />
                <Route>
                  <AuthGate>
                    <>
                      <TaskNudgeProvider />
                      <Router />
                    </>
                  </AuthGate>
                </Route>
              </Switch>
            </AuthProvider>
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  );
}

export default App;
