import { createRoot } from "react-dom/client";
import { Component, type ReactNode } from "react";
import { BrowserRouter, Outlet, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth.js";
import { AdminLayout, Page, RequireUser, SiteLayout } from "./components.js";
import { HomePage, GamesPage, GameDetailPage, HowItWorksPage, FAQPage, SupportPage, TicketPage, PolicyPage, ResponsiblePlayPage } from "./pages/PublicPages.js";
import { LoginPage, RegisterPage, ResetPasswordPage, VerifyEmailPage, AccountSecurityPage, AccountVerificationPage } from "./pages/AuthPages.js";
import { DashboardPage } from "./pages/DashboardPage.js";
import { MatchFinderPage, MatchPage } from "./pages/GamePages.js";
import { AdminOverviewPage, AdminUsersPage, AdminMatchesPage, AdminFinancePage, AdminReconciliationPage, AdminDisputesPage, AdminVerificationPage, AdminAuditPage, AdminSupportPage } from "./pages/AdminPages.js";
import "./styles.css";
import "./landing.css";

function MissingPage(){return <Page className="narrow not-found"><p className="eyebrow">404 · WRONG TURN</p><h1>This page isn’t on the board.</h1><p className="muted">The link may be old, or the page may not be available yet.</p><button className="button button-gold" onClick={()=>{window.location.href="/";}}>Return home</button></Page>;}

class RootErrorBoundary extends Component<{children:ReactNode},{failed:boolean}>{
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  render(){return this.state.failed?<main className="page narrow"><p className="eyebrow">APPLICATION ERROR</p><h1>This page could not be loaded.</h1><p className="muted">Your account and saved match records have not been changed. Try again or return home.</p><div className="button-row"><button className="button button-gold" onClick={()=>window.location.reload()}>Try again</button><button className="button button-quiet" onClick={()=>{window.location.href="/";}}>Return home</button></div></main>:this.props.children;}
}

function App(){return <BrowserRouter><AuthProvider><Routes>
  <Route element={<SiteLayout/>}>
    <Route index element={<HomePage/>}/>
    <Route path="games" element={<GamesPage/>}/>
    <Route path="games/:slug" element={<GameDetailPage/>}/>
    <Route path="how-it-works" element={<HowItWorksPage/>}/>
    <Route path="faq" element={<FAQPage/>}/>
    <Route path="support" element={<SupportPage/>}/>
    <Route path="terms" element={<PolicyPage kind="terms"/>}/>
    <Route path="privacy" element={<PolicyPage kind="privacy"/>}/>
    <Route path="wallet-policy" element={<PolicyPage kind="wallet"/>}/>
    <Route path="fair-play" element={<PolicyPage kind="fair"/>}/>
    <Route path="responsible-play" element={<ResponsiblePlayPage/>}/>
    <Route path="login" element={<LoginPage/>}/>
    <Route path="register" element={<RegisterPage/>}/>
    <Route path="reset-password" element={<ResetPasswordPage/>}/>
    <Route path="verify-email" element={<VerifyEmailPage/>}/>
    <Route element={<RequireUser><Outlet/></RequireUser>}>
      <Route path="play" element={<MatchFinderPage/>}/>
      <Route path="dashboard" element={<DashboardPage/>}/>
      <Route path="account/security" element={<AccountSecurityPage/>}/>
      <Route path="account/verification" element={<AccountVerificationPage/>}/>
      <Route path="matches/:matchId" element={<MatchPage/>}/>
      <Route path="support/tickets/:ticketId" element={<TicketPage/>}/>
    </Route>
    <Route path="*" element={<MissingPage/>}/>
  </Route>
  <Route path="/admin" element={<AdminLayout/>}>
    <Route index element={<AdminOverviewPage/>}/>
    <Route path="users" element={<AdminUsersPage/>}/>
    <Route path="matches" element={<AdminMatchesPage/>}/>
    <Route path="support" element={<AdminSupportPage/>}/>
    <Route path="verification" element={<AdminVerificationPage/>}/>
    <Route path="finance" element={<AdminFinancePage/>}/>
    <Route path="reconciliation" element={<AdminReconciliationPage/>}/>
    <Route path="disputes" element={<AdminDisputesPage/>}/>
    <Route path="audit" element={<AdminAuditPage/>}/>
    <Route path="*" element={<MissingPage/>}/>
  </Route>
  <Route path="*" element={<MissingPage/>}/>
</Routes></AuthProvider></BrowserRouter>;}

const root=document.getElementById("root");
if(!root)throw new Error("Application root is missing.");
createRoot(root).render(<RootErrorBoundary><App/></RootErrorBoundary>);
