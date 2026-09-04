import { CONTRACT_ADDRESS, EXPLORER_URL, STUDIO_URL } from "../lib/config";
import { shortAddress } from "../lib/format";

export default function Footer() {
  return (
    <footer className="footer">
      <div>
        <span className="micro">ReplicaStake · GenLayer StudioNet</span>
        <p style={{ marginTop: 10 }}>
          A demo of what an intelligent contract is actually for: settlement around a
          judgment that no deterministic chain and no oracle can make on its own. The
          compute stays off-chain; only the verdict and the money are on it.
        </p>
      </div>
      <div className="readout" style={{ textAlign: "right" }}>
        <div>
          contract:{" "}
          {CONTRACT_ADDRESS ? shortAddress(CONTRACT_ADDRESS) : "not deployed"}
        </div>
        <div>
          <a href={STUDIO_URL} target="_blank" rel="noreferrer noopener">
            studio.genlayer.com
          </a>
        </div>
        <div>
          <a href={EXPLORER_URL} target="_blank" rel="noreferrer noopener">
            explorer
          </a>
        </div>
      </div>
    </footer>
  );
}
