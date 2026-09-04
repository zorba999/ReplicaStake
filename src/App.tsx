import { useCallback, useEffect, useState } from "react";

import { ScrollTrigger } from "./anim/motion";
import ClaimDrawer from "./components/ClaimDrawer";
import Consensus from "./components/Consensus";
import Crosshair from "./components/Crosshair";
import Footer from "./components/Footer";
import Hero from "./components/Hero";
import Mechanism from "./components/Mechanism";
import PaperGrid from "./components/PaperGrid";
import Preloader from "./components/Preloader";
import Registry from "./components/Registry";
import RegisterForm from "./components/RegisterForm";
import Ticker from "./components/Ticker";
import TxConsole from "./components/TxConsole";
import { cleanContractError, send } from "./lib/contract";
import { log, logErr, logOk } from "./lib/log";
import { useRegistry } from "./lib/useRegistry";
import ConnectButton from "./wallet/ConnectButton";
import { useWallet } from "./wallet/WalletContext";

export default function App() {
  const wallet = useWallet();
  const registry = useRegistry(wallet.address);
  const [ready, setReady] = useState(false);
  const [openClaim, setOpenClaim] = useState<string | null>(null);
  const [faucetBusy, setFaucetBusy] = useState(false);

  // Sections measure themselves only once the preloader has released the page.
  useEffect(() => {
    if (!ready) return;
    const id = window.setTimeout(() => ScrollTrigger.refresh(), 120);
    return () => window.clearTimeout(id);
  }, [ready, registry.claims.length]);

  const scrollTo = useCallback((id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const claimFaucet = useCallback(async () => {
    if (!wallet.client || wallet.wrongNetwork) return;
    setFaucetBusy(true);
    try {
      log("claim_credits: requesting grant");
      await send(wallet.client, "claim_credits", [], (message) => log(message));
      logOk("10 000 RSC credited");
      await registry.refreshBalance();
    } catch (caught) {
      const message = cleanContractError(
        caught instanceof Error ? caught.message : String(caught),
      );
      logErr(`claim_credits: ${message}`);
    } finally {
      setFaucetBusy(false);
    }
  }, [wallet.client, wallet.wrongNetwork, registry]);

  return (
    <>
      <Preloader onDone={() => setReady(true)} />
      <PaperGrid />
      <Crosshair />

      <div className="corner corner--tr">
        <span className="micro" style={{ marginRight: 4 }}>
          studionet
        </span>
        <ConnectButton
          credits={registry.balance?.credits}
          onFaucet={() => void claimFaucet()}
          faucetBusy={faucetBusy}
          faucetUsed={registry.balance?.faucet_used}
        />
      </div>

      <main className="shell">
        <Hero
          stats={registry.stats}
          onBrowse={() => scrollTo("registry")}
          onRegister={() => scrollTo("stake")}
        />
        <Ticker />
        <Mechanism />
        <Consensus />
        <Registry
          claims={registry.claims}
          loading={registry.loading}
          error={registry.error}
          onOpen={(claim) => setOpenClaim(claim.claim_id)}
          onRefresh={() => void registry.refreshAll()}
        />
        <RegisterForm
          credits={registry.balance?.credits ?? ""}
          faucetUsed={Boolean(registry.balance?.faucet_used)}
          onFaucet={() => void claimFaucet()}
          onRegistered={() => void registry.refreshAll()}
        />
        <Footer />
      </main>

      <ClaimDrawer
        claimId={openClaim}
        onClose={() => setOpenClaim(null)}
        onSettled={() => void registry.refreshAll()}
      />
      <TxConsole busy={faucetBusy} />
    </>
  );
}
