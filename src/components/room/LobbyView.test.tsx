// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@/hooks/useRoomPresence", () => ({
  useRoomPresence: vi.fn(),
}));

import { useRoomPresence } from "@/hooks/useRoomPresence";

// Locale mock — RefreshContestantsButton uses useTranslations.
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

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

import type { Contestant } from "@/types";
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
  onRefreshContestants?: () => Promise<{
    added: string[];
    removed: string[];
    reordered: string[];
  } | null>;
  announcementMode?: "live" | "instant";
  onChangeAnnouncementMode?: (mode: "live" | "instant") => Promise<void>;
  categoriesOverride?: { name: string; hint?: string }[];
  onChangeCategories?: (
    categories: { name: string; weight: number; hint?: string }[],
  ) => Promise<void>;
  roomId?: string;
  currentUserId?: string;
  presenceUserIds?: Set<string>;
  broadcastStartUtc?: string | null;
  contestants?: Contestant[];
}

function renderLobby(opts: RenderOpts = {}) {
  vi.mocked(useRoomPresence).mockReturnValue(opts.presenceUserIds ?? new Set());
  const onStartVoting = vi.fn();
  const onCopyPin = vi.fn();
  const onCopyLink = vi.fn();
  const ui = (
    <LobbyView
      pin="ABC123"
      ownerUserId={opts.ownerUserId ?? ALICE.userId}
      memberships={opts.memberships ?? [ALICE, BOB]}
      categories={opts.categoriesOverride ?? CATEGORIES}
      isAdmin={opts.isAdmin ?? true}
      startVotingState={opts.startVotingState ?? { kind: "idle" }}
      shareUrl="https://eurovisionmaxxing.com/room/r-1"
      onStartVoting={onStartVoting}
      onCopyPin={onCopyPin}
      onCopyLink={onCopyLink}
      onRefreshContestants={opts.onRefreshContestants}
      announcementMode={opts.announcementMode}
      onChangeAnnouncementMode={opts.onChangeAnnouncementMode}
      onChangeCategories={opts.onChangeCategories}
      roomId={opts.roomId ?? "r-1"}
      currentUserId={opts.currentUserId ?? ALICE.userId}
      broadcastStartUtc={opts.broadcastStartUtc}
      contestants={opts.contestants ?? []}
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

  it("shows a host-only header + start-button helper so admins don't accidentally start voting", () => {
    renderLobby({ isAdmin: true });
    expect(screen.getByRole("heading", { name: /you.?re the host/i })).toBeInTheDocument();
    expect(screen.getByText(/host lobby/i)).toBeInTheDocument();
    expect(
      screen.getByText(/share the pin or qr with your guests/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/starts voting for everyone in the room/i),
    ).toBeInTheDocument();
  });

  it("hides the host-only header and helper from non-admin guests", () => {
    renderLobby({ isAdmin: false });
    expect(
      screen.queryByRole("heading", { name: /you.?re the host/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/host lobby/i)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/starts voting for everyone in the room/i),
    ).not.toBeInTheDocument();
  });

  it("flags the owner with a star marker in the participant roster", () => {
    renderLobby({ ownerUserId: ALICE.userId });
    const aliceRow = screen.getByText(/alice/i);
    expect(aliceRow).toHaveTextContent("★");
    const bobRow = screen.getByText(/bob/i);
    expect(bobRow).not.toHaveTextContent("★");
  });

  it("renders the Refresh contestants button when admin + onRefreshContestants is provided", () => {
    const onRefreshContestants = vi
      .fn()
      .mockResolvedValue({ added: [], removed: [], reordered: [] });
    renderLobby({ isAdmin: true, onRefreshContestants });
    expect(
      screen.getByRole("button", { name: /lobby.refreshContestants.button/ }),
    ).toBeInTheDocument();
  });

  it("hides the Refresh contestants button when isAdmin is false", () => {
    const onRefreshContestants = vi.fn();
    renderLobby({ isAdmin: false, onRefreshContestants });
    expect(
      screen.queryByRole("button", {
        name: /lobby.refreshContestants.button/,
      }),
    ).toBeNull();
  });

  it("hides the Refresh contestants button when the prop isn't supplied", () => {
    renderLobby({ isAdmin: true });
    expect(
      screen.queryByRole("button", {
        name: /lobby.refreshContestants.button/,
      }),
    ).toBeNull();
  });

  it("renders the announcement-mode toggle when admin + props provided (A2)", () => {
    renderLobby({
      isAdmin: true,
      announcementMode: "live",
      onChangeAnnouncementMode: vi.fn().mockResolvedValue(undefined),
    });
    expect(
      screen.getByTestId("lobby-announcement-mode-toggle"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Live" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Instant" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("hides the mode toggle when isAdmin is false", () => {
    renderLobby({
      isAdmin: false,
      announcementMode: "live",
      onChangeAnnouncementMode: vi.fn(),
    });
    expect(
      screen.queryByTestId("lobby-announcement-mode-toggle"),
    ).toBeNull();
  });

  it("hides the mode toggle when announcementMode prop is omitted", () => {
    renderLobby({
      isAdmin: true,
      onChangeAnnouncementMode: vi.fn(),
    });
    expect(
      screen.queryByTestId("lobby-announcement-mode-toggle"),
    ).toBeNull();
  });

  it("hides the mode toggle when onChangeAnnouncementMode is omitted", () => {
    renderLobby({
      isAdmin: true,
      announcementMode: "live",
    });
    expect(
      screen.queryByTestId("lobby-announcement-mode-toggle"),
    ).toBeNull();
  });

  it("disables the currently-selected mode button (no-op if tapped)", () => {
    const onChange = vi.fn().mockResolvedValue(undefined);
    renderLobby({
      isAdmin: true,
      announcementMode: "instant",
      onChangeAnnouncementMode: onChange,
    });
    const instantBtn = screen.getByRole("button", { name: "Instant" });
    expect(instantBtn).toBeDisabled();
  });

  it("calls onChangeAnnouncementMode with the new mode when the other button is clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn().mockResolvedValue(undefined);
    renderLobby({
      isAdmin: true,
      announcementMode: "live",
      onChangeAnnouncementMode: onChange,
    });
    await user.click(screen.getByRole("button", { name: "Instant" }));
    expect(onChange).toHaveBeenCalledWith("instant");
  });

  it("renders the template picker when admin + onChangeCategories provided (A2 categories)", () => {
    renderLobby({
      isAdmin: true,
      onChangeCategories: vi.fn().mockResolvedValue(undefined),
    });
    expect(screen.getByTestId("lobby-template-picker")).toBeInTheDocument();
    // 3 predefined templates rendered
    expect(screen.getByRole("button", { name: /The Classic/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /The Spectacle/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /The Banger Test/i })).toBeInTheDocument();
  });

  it("hides the template picker when isAdmin is false", () => {
    renderLobby({
      isAdmin: false,
      onChangeCategories: vi.fn(),
    });
    expect(screen.queryByTestId("lobby-template-picker")).toBeNull();
  });

  it("hides the template picker when onChangeCategories is omitted", () => {
    renderLobby({ isAdmin: true });
    expect(screen.queryByTestId("lobby-template-picker")).toBeNull();
  });

  it("highlights + disables the matching template button (Classic by name set)", () => {
    const classicCats = [
      { name: "Vocals" },
      { name: "Music" },
      { name: "Outfit" },
      { name: "Stage performance" },
      { name: "Vibes" },
    ];
    renderLobby({
      isAdmin: true,
      categoriesOverride: classicCats,
      onChangeCategories: vi.fn().mockResolvedValue(undefined),
    });
    expect(
      screen.getByRole("button", { name: /The Classic/i }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: /The Classic/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /The Spectacle/i }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("renders the 'Custom categories' note when current set matches no template", () => {
    renderLobby({
      isAdmin: true,
      categoriesOverride: [{ name: "WeirdCustom1" }, { name: "WeirdCustom2" }],
      onChangeCategories: vi.fn().mockResolvedValue(undefined),
    });
    expect(
      screen.getByText(/Custom categories/i),
    ).toBeInTheDocument();
  });

  it("calls onChangeCategories with the new template's categories when tapped", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn().mockResolvedValue(undefined);
    // Start with Classic — tap Spectacle
    const classicCats = [
      { name: "Vocals" },
      { name: "Music" },
      { name: "Outfit" },
      { name: "Stage performance" },
      { name: "Vibes" },
    ];
    renderLobby({
      isAdmin: true,
      categoriesOverride: classicCats,
      onChangeCategories: onChange,
    });
    await user.click(screen.getByRole("button", { name: /The Spectacle/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const arg = onChange.mock.calls[0][0] as { name: string }[];
    expect(arg.map((c) => c.name)).toContain("Drama");
    expect(arg.map((c) => c.name)).toContain("Costume commitment");
  });

  it("renders 'Open present view on TV' link for admin (L1 / §10.3)", () => {
    renderLobby({ isAdmin: true });
    const link = screen.getByTestId("lobby-present-link");
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute(
      "href",
      "https://eurovisionmaxxing.com/room/r-1/present",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("hides the present-view link for guests", () => {
    renderLobby({ isAdmin: false });
    expect(
      screen.queryByTestId("lobby-present-link"),
    ).not.toBeInTheDocument();
  });
});

describe("<LobbyView> — countdown section (R2 #238)", () => {
  it("renders <LobbyCountdown> in fallback state when broadcastStartUtc is null", () => {
    renderLobby({ broadcastStartUtc: null });
    const countdown = screen.getByTestId("lobby-countdown");
    expect(countdown).toHaveAttribute("data-state", "fallback");
  });

  it("renders <LobbyCountdown> in ticking state when broadcastStartUtc is a future ISO timestamp", () => {
    renderLobby({ broadcastStartUtc: "2099-01-01T00:00:00.000Z" });
    const countdown = screen.getByTestId("lobby-countdown");
    expect(countdown).toHaveAttribute("data-state", "ticking");
  });
});

describe("<LobbyView> — presence indicators (R2 #239)", () => {
  it("renders online treatment for members in the presence Set", () => {
    renderLobby({
      memberships: [ALICE],
      presenceUserIds: new Set([ALICE.userId]),
    });
    const row = screen.getByTestId(`lobby-member-${ALICE.userId}`);
    expect(row).toHaveAttribute("data-online", "true");
    expect(row).not.toHaveClass("opacity-50");
  });

  it("renders offline treatment (opacity-50) for members not in the presence Set", () => {
    renderLobby({
      memberships: [BOB],
      presenceUserIds: new Set(),
    });
    const row = screen.getByTestId(`lobby-member-${BOB.userId}`);
    expect(row).toHaveAttribute("data-online", "false");
    expect(row).toHaveClass("opacity-50");
  });

  it("preserves owner star regardless of online state", () => {
    renderLobby({
      memberships: [ALICE],
      ownerUserId: ALICE.userId,
      presenceUserIds: new Set(),
    });
    expect(screen.getByText("★")).toBeInTheDocument();
  });
});

describe("<LobbyView> — primer carousel section (R2 #240)", () => {
  it("renders the contestant primer carousel when contestants array is non-empty", () => {
    const fixture: Contestant[] = [
      {
        id: "9999-se",
        country: "Sweden",
        countryCode: "se",
        flagEmoji: "🇸🇪",
        artist: "Felicia",
        song: "My System",
        runningOrder: 1,
        event: "final",
        year: 9999,
      },
    ];
    renderLobby({ contestants: fixture });
    expect(screen.getByTestId("contestant-primer-carousel")).toBeInTheDocument();
  });

  it("hides the carousel section when contestants array is empty", () => {
    renderLobby({ contestants: [] });
    expect(screen.queryByTestId("contestant-primer-carousel")).toBeNull();
  });
});
