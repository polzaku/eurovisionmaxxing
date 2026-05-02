// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// QrCode generates a data URL asynchronously via the `qrcode` package.
// Stub it out to keep tests deterministic + fast — we only care that the
// alt text + size flow through.
vi.mock("@/components/ui/QrCode", () => ({
  default: ({
    url,
    size,
    alt,
  }: {
    url: string;
    size: number;
    alt?: string;
  }) => (
    <div data-testid="qr-stub" data-url={url} data-size={size} aria-label={alt}>
      QR
    </div>
  ),
}));

// Avatar uses DiceBear; it works in jsdom but stubbing keeps the test
// surface focused on LobbyView's own behaviour.
vi.mock("@/components/ui/Avatar", () => ({
  default: ({ seed }: { seed: string }) => (
    <span data-testid="avatar" data-seed={seed} />
  ),
}));

import LobbyView, {
  type LobbyMember,
  type LobbyCategory,
  type StartVotingState,
} from "./LobbyView";

const ALICE: LobbyMember = {
  userId: "u-alice",
  displayName: "Alice",
  avatarSeed: "seed-alice",
};
const BOB: LobbyMember = {
  userId: "u-bob",
  displayName: "Bob",
  avatarSeed: "seed-bob",
};
const CATEGORIES: LobbyCategory[] = [
  { name: "Vocals", hint: "Pitch + power" },
  { name: "Outfit", hint: "Stage drama" },
];

interface RenderOpts {
  isAdmin?: boolean;
  startVotingState?: StartVotingState;
  memberships?: LobbyMember[];
  ownerUserId?: string;
}

function renderLobby(opts: RenderOpts = {}) {
  const onStartVoting = vi.fn();
  const onCopyPin = vi.fn();
  const onCopyLink = vi.fn();
  const ui = (
    <LobbyView
      pin="ABC123"
      ownerUserId={opts.ownerUserId ?? ALICE.userId}
      memberships={opts.memberships ?? [ALICE, BOB]}
      categories={CATEGORIES}
      isAdmin={opts.isAdmin ?? true}
      startVotingState={opts.startVotingState ?? { kind: "idle" }}
      shareUrl="https://eurovisionmaxxing.com/room/r-1"
      onStartVoting={onStartVoting}
      onCopyPin={onCopyPin}
      onCopyLink={onCopyLink}
    />
  );
  return { ...render(ui), onStartVoting, onCopyPin, onCopyLink };
}

describe("<LobbyView>", () => {
  it("renders the PIN, the share-link input, and the QR stub for an admin", () => {
    renderLobby({ isAdmin: true });
    expect(screen.getByText("ABC123")).toBeInTheDocument();
    expect(
      screen.getByDisplayValue("https://eurovisionmaxxing.com/room/r-1"),
    ).toBeInTheDocument();
    const qr = screen.getByTestId("qr-stub");
    expect(qr).toHaveAttribute("data-size", "256");
    expect(qr).toHaveAttribute(
      "data-url",
      "https://eurovisionmaxxing.com/room/r-1",
    );
  });

  it("hides QR + share link for non-admin guests but still shows PIN", () => {
    renderLobby({ isAdmin: false });
    expect(screen.getByText("ABC123")).toBeInTheDocument();
    expect(screen.queryByTestId("qr-stub")).not.toBeInTheDocument();
    expect(
      screen.queryByDisplayValue("https://eurovisionmaxxing.com/room/r-1"),
    ).not.toBeInTheDocument();
  });

  it("hides Start-voting CTA for non-admin guests and shows waiting copy", () => {
    renderLobby({ isAdmin: false });
    expect(
      screen.queryByRole("button", { name: /start voting/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/waiting for the host to start voting/i),
    ).toBeInTheDocument();
  });

  it("fires onCopyPin and shows transient 'Copied!' label", async () => {
    const { onCopyPin } = renderLobby({ isAdmin: true });
    const pinCopyBtn = screen.getByRole("button", { name: /copy pin/i });
    await userEvent.click(pinCopyBtn);
    expect(onCopyPin).toHaveBeenCalledTimes(1);
    expect(pinCopyBtn).toHaveTextContent(/copied!/i);
  });

  it("fires onCopyLink and shows transient 'Copied!' label", async () => {
    const { onCopyLink } = renderLobby({ isAdmin: true });
    const linkCopyBtn = screen.getByRole("button", {
      name: /copy share link/i,
    });
    await userEvent.click(linkCopyBtn);
    expect(onCopyLink).toHaveBeenCalledTimes(1);
    expect(linkCopyBtn).toHaveTextContent(/copied!/i);
  });

  it("fires onStartVoting when admin taps the CTA", async () => {
    const { onStartVoting } = renderLobby({ isAdmin: true });
    await userEvent.click(screen.getByRole("button", { name: /start voting/i }));
    expect(onStartVoting).toHaveBeenCalledTimes(1);
  });

  it("disables the Start-voting CTA and swaps copy while submitting", () => {
    renderLobby({
      isAdmin: true,
      startVotingState: { kind: "submitting" },
    });
    const cta = screen.getByRole("button", { name: /starting…/i });
    expect(cta).toBeDisabled();
  });

  it("renders error message in an alert when start-voting fails", () => {
    renderLobby({
      isAdmin: true,
      startVotingState: { kind: "error", message: "PIN regeneration failed" },
    });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("PIN regeneration failed");
  });

  it("flags the owner with a star marker in the participant roster", () => {
    renderLobby({ ownerUserId: ALICE.userId });
    const aliceRow = screen.getByText(/alice/i);
    expect(aliceRow).toHaveTextContent("★");
    const bobRow = screen.getByText(/bob/i);
    expect(bobRow).not.toHaveTextContent("★");
  });
});
