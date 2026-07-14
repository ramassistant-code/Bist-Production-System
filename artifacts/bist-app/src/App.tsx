import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

import { AuthProvider, useAuth } from "@/lib/auth-context";

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
import Tasks from "@/pages/tasks";
import Settings from "@/pages/settings";
import QuotePdfTemplate from "@/pages/quote-pdf-template";
import MondaySettings from "@/pages/monday-settings";
import MondayRunDetail from "@/pages/monday-run-detail";
import Login from "@/pages/login";
import NotFound from "@/pages/not-found";

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
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <p className="text-gray-500 text-sm">טוען...</p>
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
      <Route path="/" component={Dashboard} />
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
      <Route path="/production" component={Production} />
      <Route path="/tasks" component={Tasks} />
      <Route path="/settings/quote-pdf-template" component={QuotePdfTemplate} />
      <Route path="/settings/monday/runs/:id" component={MondayRunDetail} />
      <Route path="/settings/monday" component={MondaySettings} />
      <Route path="/settings" component={Settings} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthProvider>
            <AuthGate>
              <Router />
            </AuthGate>
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
