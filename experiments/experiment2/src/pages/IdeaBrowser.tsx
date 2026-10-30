// PROTOTYPE: Open | Closed idea lists, shared by the Ideas page and team pages.
// Built for thousands of ideas: filters narrow on the server's terms (drafts,
// closed reason, author, reviewer, team), people and teams are picked by
// type-ahead (never a giant dropdown), and results come 25 to a page.
import { useMemo, type ReactNode } from "react";
import { ME, type Idea } from "../data";
import { useStore } from "../store";
import { isArchived, isClosed, isOpen } from "../model";
import { rank } from "../search";
import {
  Combobox,
  Empty,
  IdeaRow,
  fmt,
  type RowHide,
  usePaged,
  useParam,
  usePeopleSearch,
  useSetParams,
  useTeamSearch,
} from "../ui";

type Tab = "open" | "closed";
type DraftFilter = "any" | "only" | "hide";
type ReasonFilter = "any" | "accepted" | "rejected" | "archived";

export function IdeaBrowser({
  pool,
  query = "",
  teamFilter = false,
  rowExtra,
  hide,
}: {
  pool: Idea[];
  query?: string;
  teamFilter?: boolean;
  rowExtra?: (i: Idea) => ReactNode; // e.g. "Move to a team…" in Your ideas
  hide?: RowHide; // what the page already says (the team, the author)
}) {
  const { state } = useStore();
  const [tab, setTab] = useParam<Tab>("tab", "open");
  const [draft, setDraft] = useParam<DraftFilter>("draft", "any");
  const [author, setAuthor] = useParam<string>("author", "");
  const [reviewer, setReviewer] = useParam<"" | "me">("review", "");
  const [reason, setReason] = useParam<ReasonFilter>("reason", "any");
  const [team, setTeam] = useParam<string>("team", "");
  const setParams = useSetParams();
  const people = usePeopleSearch();
  const teams = useTeamSearch();

  const myGroups = useMemo(
    () =>
      new Set(
        state.groups.filter((g) => g.members.includes(ME)).map((g) => g.id),
      ),
    [state.groups],
  );
  const myTeamIds = useMemo(
    () =>
      new Set(
        state.teams.filter((t) => t.members.includes(ME)).map((t) => t.id),
      ),
    [state.teams],
  );

  const { open, closed } = useMemo(() => {
    const inTeam = (i: Idea) =>
      !teamFilter || !team
        ? true
        : team === "mine"
          ? myTeamIds.has(i.teamId)
          : i.teamId === team;
    const byAuthor = (i: Idea) =>
      !author
        ? true
        : author === "me"
          ? i.authorId === ME
          : i.authorId === author;
    const byReviewer = (i: Idea) =>
      !reviewer
        ? true
        : i.reviewers.some((r) =>
            r.kind === "user" ? r.userId === ME : myGroups.has(r.groupId),
          );
    const base = pool.filter((i) => inTeam(i) && byAuthor(i) && byReviewer(i));
    return {
      open: base.filter((i) => isOpen(state, i)),
      closed: base.filter((i) => isClosed(state, i)),
    };
  }, [pool, team, author, reviewer, teamFilter, myGroups, myTeamIds, state]);

  const results = useMemo(() => {
    const shown =
      tab === "open"
        ? open.filter((i) =>
            draft === "only"
              ? i.status === "draft"
              : draft === "hide"
                ? i.status !== "draft"
                : true,
          )
        : closed.filter((i) =>
            reason === "any"
              ? true
              : reason === "archived"
                ? isArchived(state, i)
                : !isArchived(state, i) && i.closedReason === reason,
          );
    return query.trim()
      ? rank(shown, query, (i) => [
          { name: "title", text: i.title, weight: 0 },
          {
            name: "team",
            text: state.teams.find((t) => t.id === i.teamId)?.name ?? "",
            weight: 1,
          },
          {
            name: "author",
            text: state.users[i.authorId]?.name ?? "",
            weight: 2,
          },
          { name: "description", text: i.description, weight: 3 },
        ]).map((r) => r.item)
      : [...shown].sort(
          (a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
        );
  }, [tab, open, closed, draft, reason, query, state]);

  const { slice, pager } = usePaged(results);
  const filtered =
    (tab === "open" ? draft !== "any" : reason !== "any") ||
    !!author ||
    !!reviewer ||
    (teamFilter && !!team);

  return (
    <div className="browser">
      <div className="tabs" role="tablist">
        <button
          role="tab"
          aria-selected={tab === "open"}
          className={tab === "open" ? "on" : ""}
          onClick={() => setTab("open")}
        >
          Open <span className="tag">{fmt(open.length)}</span>
        </button>
        <button
          role="tab"
          aria-selected={tab === "closed"}
          className={tab === "closed" ? "on" : ""}
          onClick={() => setTab("closed")}
        >
          Closed <span className="tag">{fmt(closed.length)}</span>
        </button>
      </div>

      <div className="toolbar">
        {tab === "open" ? (
          <label className="filter">
            <span>Drafts</span>
            <select
              value={draft}
              onChange={(e) => setDraft(e.target.value as DraftFilter)}
            >
              <option value="any">Included</option>
              <option value="only">Drafts only</option>
              <option value="hide">Hidden</option>
            </select>
          </label>
        ) : (
          <label className="filter">
            <span>Closed as</span>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value as ReasonFilter)}
            >
              <option value="any">Any reason</option>
              <option value="accepted">Accepted</option>
              <option value="rejected">Rejected</option>
              <option value="archived">Archived (team archived)</option>
            </select>
          </label>
        )}
        <label className="filter">
          <span>Reviewer</span>
          <select
            value={reviewer}
            onChange={(e) => setReviewer(e.target.value as "" | "me")}
          >
            <option value="">Anyone</option>
            <option value="me">You (or your groups)</option>
          </select>
        </label>
        {/* no author filter when every row has the same author (Your ideas) */}
        {!hide?.author && (
          <div className="filter">
            <span>Author</span>
            <Combobox
              label="Author"
              anyLabel="Anyone"
              placeholder="Search by name or @handle."
              value={author}
              onChange={setAuthor}
              search={people.search}
              display={(id) =>
                id === "me"
                  ? { id, label: "You", avatar: ME }
                  : people.option(id)
              }
              pinned={[{ id: "me", label: "You", avatar: ME }]}
            />
          </div>
        )}
        {teamFilter && (
          <div className="filter">
            <span>Team</span>
            <Combobox
              label="Team"
              anyLabel="All teams"
              placeholder="Search by team name."
              value={team}
              onChange={setTeam}
              search={teams.search}
              display={(id) =>
                id === "mine" ? { id, label: "Your teams" } : teams.option(id)
              }
              pinned={[
                {
                  id: "mine",
                  label: "Your teams",
                  sub: `${myTeamIds.size} teams`,
                },
              ]}
            />
          </div>
        )}
        {filtered && (
          <button
            className="link"
            onClick={() =>
              setParams({
                draft: undefined,
                reason: undefined,
                author: undefined,
                review: undefined,
                team: undefined,
              })
            }
          >
            Clear filters
          </button>
        )}
        <span className="muted toolbar-note">
          {fmt(results.length)} idea{results.length === 1 ? "" : "s"} ·{" "}
          {query.trim()
            ? "best match first"
            : tab === "open"
              ? "recently updated first"
              : "recently closed first"}
        </span>
      </div>

      <div className="card-list">
        {slice.map((i) => (
          <IdeaRow
            key={i.id}
            idea={i}
            query={query}
            extra={rowExtra?.(i)}
            hide={hide}
          />
        ))}
      </div>
      {pager}
      {results.length === 0 && (
        <Empty>
          No {tab} ideas match{query.trim() ? ` “${query.trim()}”` : ""}
          {filtered ? " these filters" : ""}.
        </Empty>
      )}
    </div>
  );
}
