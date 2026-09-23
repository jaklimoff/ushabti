"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/client";
import { canManage, isOwner, outranks, rolesOffered, type Role } from "@/lib/roles";
import { isListening } from "@/lib/presence";
import { useBoard } from "@/components/board/store";
import { Avatar } from "@/components/ui/Avatar";
import { Button, IconButton } from "@/components/ui/Button";
import { CopyField } from "@/components/ui/CopyField";
import { Input, Select } from "@/components/ui/Form";
import { Card, EmptyState, Foot, Note, Row, Section, Spacer, Tag } from "@/components/ui/Layout";
import { ConfirmRow, useConfirm } from "@/components/ui/ConfirmRow";
import type { AgentDTO, InviteDTO, MemberDTO } from "@/lib/types";
import { PageHead } from "./SettingsShell";
import styles from "./settings.module.css";

export function PeoplePanel() {
  const { data } = useBoard();
  const [agents, setAgents] = useState<AgentDTO[] | null>(null);
  const projectId = data.project.id;

  const loadAgents = useCallback(async () => {
    try {
      const res = await api.get<{ agents: AgentDTO[] }>(`/api/projects/${projectId}/agents`);
      setAgents(res.agents);
    } catch {
      setAgents([]);
    }
  }, [projectId]);

  // The agent list is not part of the board, so it is fetched rather than
  // rendered on the server: the token tick has to be able to ask again.
  useEffect(() => {
    let alive = true;
    void api
      .get<{ agents: AgentDTO[] }>(`/api/projects/${projectId}/agents`)
      .then((res) => alive && setAgents(res.agents))
      .catch(() => alive && setAgents([]));
    return () => {
      alive = false;
    };
  }, [projectId]);

  return (
    <>
      <PageHead
        title="People"
        note="Everybody here can create, edit and move tasks. An admin also adds people and agents and changes the shape of the project; only the owner can delete it. An agent is always a member — it just signs in with a token."
      />
      <Members />
      <Agents agents={agents} reload={loadAgents} />
    </>
  );
}

/* ------------------------------------------------------------------ */

function Members() {
  const { data, refresh, notify, user } = useBoard();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [invited, setInvited] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canEdit = canManage(data.project.role);
  const origin = useSyncExternalStore(
    subscribeNothing,
    () => window.location.origin,
    () => "",
  );
  const signUpLink = origin ? `${origin}/register` : "";

  async function invite() {
    const value = email.trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    setInvited(null);
    try {
      const answer = await api.post<{ invite?: InviteDTO }>(
        `/api/projects/${data.project.id}/members`,
        { email: value },
      );
      // No account yet, so the email waits as an invite: say what happens next.
      if (answer.invite) setInvited(answer.invite.email);
      setEmail("");
      await refresh();
    } catch (err) {
      // Inline rather than a toast: the next step is the link underneath.
      setError(err instanceof Error ? err.message : "Could not add that person.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(member: MemberDTO) {
    try {
      await api.del(`/api/projects/${data.project.id}/members/${member.id}`);
      if (member.id === user.id) router.replace("/projects");
      else await refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not remove that person.");
    }
  }

  async function changeRole(member: MemberDTO, role: Role) {
    try {
      await api.patch(`/api/projects/${data.project.id}/members/${member.id}`, { role });
      await refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not change that role.");
    }
  }

  async function withdraw(invite: InviteDTO) {
    try {
      await api.del(`/api/projects/${data.project.id}/invites/${encodeURIComponent(invite.email)}`);
      await refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not withdraw that invite.");
    }
  }

  const people = data.members.filter((m) => m.kind === "human");

  return (
    <Section title="Members">
      <Card>
        {people.map((member) => (
          <MemberRow
            key={member.id}
            member={member}
            isSelf={member.id === user.id}
            canRemove={
              member.id === user.id
                ? !isOwner(member.role)
                : outranks(data.project.role, member.role)
            }
            /* Never your own row: /account changes a password you know. The
               route asks the same `outranks`, so an admin gets it for a
               member and only the owner for an admin. */
            canReset={member.id !== user.id && outranks(data.project.role, member.role)}
            roles={rolesOffered(data.project.role, member.role, member.kind, member.id === user.id)}
            onRole={(role) => void changeRole(member, role)}
            projectId={data.project.id}
            onRemove={() => void remove(member)}
          />
        ))}
        {data.invites.map((invite) => (
          <InviteRow
            key={invite.email}
            invite={invite}
            canWithdraw={canEdit}
            onWithdraw={() => void withdraw(invite)}
          />
        ))}

        {canEdit && (
          <Foot>
            <Input
              style={{ flex: 1, minWidth: 180 }}
              aria-label="Email of the new member"
              value={email}
              invalid={error !== null}
              placeholder="friend@example.com"
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
                setInvited(null);
              }}
              onKeyDown={(e) => e.key === "Enter" && void invite()}
            />
            <Button onClick={() => void invite()} disabled={busy}>
              {busy ? "Adding…" : "Add member"}
            </Button>
            {error ? (
              <span
                style={{ width: "100%", fontSize: 11.5, color: "var(--danger-text)" }}
                role="alert"
              >
                {error}
              </span>
            ) : invited && signUpLink ? (
              <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 7 }}>
                <Note>
                  {invited} has no account yet, so it is invited. Send them this link; they are in
                  the moment they sign up with that email.
                </Note>
                <CopyField value={signUpLink} label="the sign-up link" />
              </div>
            ) : (
              <span style={{ width: "100%" }}>
                <Note>
                  A person with an account joins at once. One without is invited, and joins when
                  they sign up with that email — even on a closed board.
                </Note>
              </span>
            )}
          </Foot>
        )}
      </Card>
    </Section>
  );
}

function MemberRow({
  member,
  isSelf,
  canRemove,
  canReset,
  roles,
  onRole,
  projectId,
  onRemove,
}: {
  member: MemberDTO;
  isSelf: boolean;
  canRemove: boolean;
  canReset: boolean;
  /** The roles the select offers; empty when this row has no select. */
  roles: Role[];
  onRole: (role: Role) => void;
  projectId: string;
  onRemove: () => void;
}) {
  const { notify } = useBoard();
  const confirm = useConfirm();
  const reset = useConfirm();
  const handOver = useConfirm();
  /** The link, held until the person leaves the page, as a token is. */
  const [link, setLink] = useState<string | null>(null);

  async function makeLink() {
    try {
      const res = await api.post<{ link: string }>(
        `/api/projects/${projectId}/members/${member.id}/reset`,
      );
      setLink(res.link);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not make a reset link.");
    }
  }

  if (confirm.asking) {
    return (
      <ConfirmRow
        question={
          isSelf
            ? "Leave this project? Only the owner or an admin can put you back."
            : `Remove ${member.name}? They lose the board; their tasks and comments stay.`
        }
        confirmLabel={isSelf ? "Yes, leave" : "Yes, remove"}
        onConfirm={() => confirm.confirm(onRemove)}
        onCancel={confirm.cancel}
      />
    );
  }

  if (handOver.asking) {
    return (
      <ConfirmRow
        question={`Make ${member.name} the owner? You become an admin.`}
        confirmLabel="Yes, make owner"
        onConfirm={() => handOver.confirm(() => onRole("owner"))}
        onCancel={handOver.cancel}
      />
    );
  }

  if (reset.asking) {
    return (
      <ConfirmRow
        question={`Make a reset link for ${member.name}? It signs them out everywhere once used.`}
        confirmLabel="Yes, make a link"
        onConfirm={() => reset.confirm(() => void makeLink())}
        onCancel={reset.cancel}
      />
    );
  }

  return (
    <>
      <Row>
        <Avatar name={member.name} color={member.color} size={22} />
        <span className={styles.memberName}>{member.name}</span>
        <span className={styles.memberMail}>{member.email}</span>
        {roles.length > 0 ? (
          /* Saves on change. Only the hand-over asks first, because it is
             the one change that takes something from the person making it. */
          <Select
            aria-label={`Role of ${member.name}`}
            value={member.role}
            onChange={(e) => {
              const next = e.target.value as Role;
              if (next === "owner") handOver.ask();
              else onRole(next);
            }}
          >
            {roles.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </Select>
        ) : isOwner(member.role) ? (
          <Tag accent>owner</Tag>
        ) : member.role === "admin" ? (
          <Tag>admin</Tag>
        ) : null}
        <Spacer />
        {canReset && (
          <Button variant="ghost" onClick={reset.ask}>
            Reset password
          </Button>
        )}
        {canRemove && (
          <IconButton
            danger
            label={isSelf ? "Leave the project" : `Remove ${member.name}`}
            title={isSelf ? "Leave the project" : "Remove from the project"}
            onClick={confirm.ask}
          >
            ✕
          </IconButton>
        )}
      </Row>
      {link && (
        <div className={styles.resetLink} data-testid="reset-link">
          <Note>
            Send this to {member.name}. It works once, for 24 hours. Reloading this page hides it
            for good.
          </Note>
          <CopyField value={link} label="the reset link" loud />
        </div>
      )}
    </>
  );
}

function InviteRow({
  invite,
  canWithdraw,
  onWithdraw,
}: {
  invite: InviteDTO;
  canWithdraw: boolean;
  onWithdraw: () => void;
}) {
  const confirm = useConfirm();

  if (confirm.asking) {
    return (
      <ConfirmRow
        question={`Withdraw the invite for ${invite.email}? They can no longer join by signing up.`}
        confirmLabel="Yes, withdraw"
        onConfirm={() => confirm.confirm(onWithdraw)}
        onCancel={confirm.cancel}
      />
    );
  }

  return (
    <Row data-testid="invite-row">
      <Avatar name={invite.email} color="var(--text-muted)" size={22} />
      <span className={styles.memberMail}>{invite.email}</span>
      <Tag>invited</Tag>
      <Spacer />
      {canWithdraw && (
        <IconButton
          danger
          label={`Withdraw the invite for ${invite.email}`}
          title="Withdraw the invite"
          onClick={confirm.ask}
        >
          ✕
        </IconButton>
      )}
    </Row>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Agents are members too, so everything else on this page already works for
 * them. Only two things are theirs alone: they are created here rather than
 * invited by email, and they sign in with a token rather than a password.
 */
function Agents({ agents, reload }: { agents: AgentDTO[] | null; reload: () => Promise<void> }) {
  const { data, notify, refresh } = useBoard();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  /** The plain text of a token, held until the person leaves the page. */
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const canEdit = canManage(data.project.role);
  const projectId = data.project.id;

  async function create() {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      await api.post(`/api/projects/${projectId}/agents`, { name: trimmed });
      setName("");
      await reload();
      await refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not add the agent.");
    } finally {
      setBusy(false);
    }
  }

  async function connect(agent: AgentDTO) {
    try {
      const res = await api.post<{ token: { id: string }; secret: string }>(
        `/api/projects/${projectId}/agents/${agent.id}/tokens`,
        { name: "default" },
      );
      setSecrets((current) => ({ ...current, [res.token.id]: res.secret }));
      await reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not issue a token.");
    }
  }

  async function revoke(tokenId: string) {
    try {
      await api.del(`/api/agent-tokens/${tokenId}`);
      setSecrets((current) => {
        const next = { ...current };
        delete next[tokenId];
        return next;
      });
      await reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not revoke the token.");
    }
  }

  async function remove(agent: AgentDTO) {
    try {
      await api.del(`/api/projects/${projectId}/agents/${agent.id}`);
      await reload();
      await refresh();
    } catch (err) {
      notify(err instanceof Error ? err.message : "Could not remove the agent.");
    }
  }

  return (
    <Section title="Agents">
      <Card>
        {agents === null && (
          <Row>
            <Note>Loading…</Note>
          </Row>
        )}

        {agents !== null && agents.length === 0 && (
          <EmptyState title="No agents yet.">
            An agent is a machine member. It signs in with a token, holds a card, and says on that
            card what it is doing while it works. Name it after the job it does.
          </EmptyState>
        )}

        {(agents ?? []).map((agent) => (
          <AgentBox
            key={agent.id}
            agent={agent}
            canEdit={canEdit}
            secrets={secrets}
            onConnect={() => void connect(agent)}
            onRevoke={(id) => void revoke(id)}
            onRemove={() => void remove(agent)}
            reload={reload}
          />
        ))}

        {canEdit && (
          <Foot>
            <Input
              style={{ flex: 1, minWidth: 180 }}
              aria-label="Name of the new agent"
              value={name}
              placeholder="Builder"
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void create()}
            />
            <Button onClick={() => void create()} disabled={busy}>
              Add agent
            </Button>
          </Foot>
        )}
      </Card>
    </Section>
  );
}

function AgentBox({
  agent,
  canEdit,
  secrets,
  onConnect,
  onRevoke,
  onRemove,
  reload,
}: {
  agent: AgentDTO;
  canEdit: boolean;
  secrets: Record<string, string>;
  onConnect: () => void;
  onRevoke: (tokenId: string) => void;
  onRemove: () => void;
  reload: () => Promise<void>;
}) {
  const confirm = useConfirm();

  return (
    <div className={styles.agentBox} data-testid="agent-box">
      {confirm.asking ? (
        <ConfirmRow
          question={`Remove ${agent.name}? Its tokens stop working at once. Its comments and its activity stay.`}
          confirmLabel="Yes, remove"
          onConfirm={() => confirm.confirm(onRemove)}
          onCancel={confirm.cancel}
        />
      ) : (
        <Row>
          <Avatar name={agent.name} color={agent.color} size={22} kind="agent" />
          <span className={styles.memberName}>{agent.name}</span>
          <Tag>agent</Tag>
          <Spacer />
          {canEdit && (
            <>
              <Button variant="ghost" onClick={onConnect}>
                Connect
              </Button>
              <IconButton
                danger
                label={`Remove the agent ${agent.name}`}
                title="Remove this agent"
                onClick={confirm.ask}
              >
                ✕
              </IconButton>
            </>
          )}
        </Row>
      )}

      {agent.tokens.map((token) => (
        <TokenRow
          key={token.id}
          token={token}
          agentName={agent.name}
          secret={secrets[token.id]}
          canEdit={canEdit}
          onRevoke={() => onRevoke(token.id)}
          reload={reload}
        />
      ))}
    </div>
  );
}

function TokenRow({
  token,
  agentName,
  secret,
  canEdit,
  onRevoke,
  reload,
}: {
  token: AgentDTO["tokens"][number];
  agentName: string;
  secret: string | undefined;
  canEdit: boolean;
  onRevoke: () => void;
  reload: () => Promise<void>;
}) {
  const confirm = useConfirm();

  if (confirm.asking) {
    return (
      <ConfirmRow
        question={`Revoke this token? ${agentName} stops working within one request.`}
        confirmLabel="Yes, revoke"
        onConfirm={() => confirm.confirm(onRevoke)}
        onCancel={confirm.cancel}
      />
    );
  }

  return (
    <>
      <div className={styles.tokenRow}>
        <span className={styles.tokenPrefix}>{token.prefix}…</span>
        <Note>
          {isListening(token.listeningAt)
            ? "listening now"
            : token.lastUsedAt
              ? `last used ${relativeDay(token.lastUsedAt)}`
              : "never used"}
        </Note>
        <Spacer />
        {canEdit && (
          <IconButton
            danger
            label={`Revoke the token ${token.prefix}`}
            title="Revoke this token"
            onClick={confirm.ask}
          >
            ✕
          </IconButton>
        )}
      </div>
      {secret && (
        <Connect
          secret={secret}
          agentName={agentName}
          answered={token.lastUsedAt !== null}
          listening={isListening(token.listeningAt)}
          reload={reload}
        />
      )}
    </>
  );
}

/**
 * Everything the person has to do next, with the values already in it. The
 * old page printed a file path that is not on the machine of anybody who ran
 * the production image, and left them to work out their own base URL.
 */
function Connect({
  secret,
  agentName,
  answered,
  listening,
  reload,
}: {
  secret: string;
  agentName: string;
  answered: boolean;
  listening: boolean;
  reload: () => Promise<void>;
}) {
  // The board knows its own address; the person was being asked to remember
  // it. Read through a store so the server render stays empty.
  const origin = useSyncExternalStore(
    subscribeNothing,
    () => window.location.origin,
    () => "",
  );

  // The loop is only closed when the token has actually been used, and then
  // again when the watcher in step 4 starts. Watch for both rather than
  // making the person reload and squint at "never used".
  useEffect(() => {
    if (answered && listening) return;
    const timer = setInterval(() => void reload(), 3000);
    return () => clearInterval(timer);
  }, [answered, listening, reload]);

  const install = `mkdir -p ~/.claude/skills/ushabti && \\
  curl -sL ${origin}/skill/SKILL.md  -o ~/.claude/skills/ushabti/SKILL.md && \\
  curl -sL ${origin}/skill/board.mjs -o ~/.claude/skills/ushabti/board.mjs`;
  const env = `export USHABTI_URL=${origin}\nexport USHABTI_TOKEN=${secret}`;
  const check = `curl -s $USHABTI_URL/api/agent/me -H "Authorization: Bearer $USHABTI_TOKEN"`;
  const watch = `node ~/.claude/skills/ushabti/board.mjs watch --on assigned,mention \\
  --run 'claude -p {prompt} --allowedTools "Bash(node:*)"'`;

  return (
    <div className={styles.connect} data-testid="agent-secret">
      <div className={styles.connectStep}>
        <span className="label">The token — readable only here, only now</span>
        <CopyField value={secret} label="the token" loud />
      </div>

      <div className={styles.connectStep}>
        <span className="label">Connect Claude Code</span>
        <span className={styles.connectSay}>
          <span className={styles.connectNum}>1</span>
          Put the skill where Claude Code finds it.
        </span>
        <CopyField value={install} label="the install command" />
        <span className={styles.connectSay}>
          <span className={styles.connectNum}>2</span>
          Give it the board and the token.
        </span>
        <CopyField value={env} label="the environment" />
        <span className={styles.connectSay}>
          <span className={styles.connectNum}>3</span>
          Check it.
        </span>
        <CopyField value={check} label="the check command" />
        <span className={styles.connectSay}>
          <span className={styles.connectNum}>4</span>
          Keep it listening, so a task assigned to {agentName} starts it by itself.
        </span>
        <CopyField value={watch} label="the watch command" />
      </div>

      <div className={`${styles.waiting} ${answered ? styles.answered : ""}`}>
        <span className={`${styles.waitDot} ${answered ? styles.answeredDot : ""}`} />
        {listening
          ? `${agentName} is listening.`
          : answered
            ? `${agentName} answered.`
            : "Waiting for the first call from this token…"}
      </div>

      <Note>
        Another framework? Put <code>SKILL.md</code> in the system prompt and ship{" "}
        <code>board.mjs</code> next to your agent.
      </Note>
    </div>
  );
}

/** window.location never changes under us, so there is nothing to subscribe to. */
function subscribeNothing() {
  return () => {};
}

/** Whole days, so the token list never has to tick. */
function relativeDay(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}
