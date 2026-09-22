import { ChevronDown, ChevronRight, Users } from 'lucide-react';
import { type ReactNode, useId, useState } from 'react';
import { cn } from '@/lib/utils';
import { DEMO_USERS, type DemoUser } from './session';

/** Seeded profiles bucketed by role, so repeated roles collapse into one entry. */
interface ProfileGroup {
  rol: DemoUser['rol'];
  profiles: DemoUser[];
}

/** Bucket the profiles by role, preserving the declaration order of DEMO_USERS. */
function groupByRole(profiles: DemoUser[]): ProfileGroup[] {
  const groups = new Map<DemoUser['rol'], DemoUser[]>();
  for (const profile of profiles) {
    const bucket = groups.get(profile.rol);
    if (bucket) {
      bucket.push(profile);
    } else {
      groups.set(profile.rol, [profile]);
    }
  }
  return [...groups].map(([rol, items]) => ({ rol, profiles: items }));
}

/**
 * Roles the MVP offers on the login panel: citizen and ambulance driver.
 *
 * The seeded administrator accounts still exist in the database and still sign
 * in if their credentials are typed, but they are not offered here: this panel
 * is what the demo shows, and everything it shows is expected to work end to
 * end. Hiding them is a presentation rule, not a permission change.
 */
const MVP_ROLES: ReadonlySet<DemoUser['rol']> = new Set(['CIUDADANO', 'CONDUCTOR']);

/** Static data: computed once at module load instead of on every render. */
const PROFILE_GROUPS = groupByRole(DEMO_USERS.filter((profile) => MVP_ROLES.has(profile.rol)));

const ROW_CLASS =
  'flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50';

const TOGGLE_CLASS =
  'flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50';

/** One selectable profile: role, email and what the account does. */
function ProfileRow({
  profile,
  disabled,
  onSelect,
}: {
  profile: DemoUser;
  disabled: boolean;
  onSelect: (profile: DemoUser) => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={`${profile.label}. ${profile.email}. ${profile.descripcion}`}
      onClick={() => onSelect(profile)}
      className={ROW_CLASS}
    >
      <span className="font-medium text-xs">{profile.label}</span>
      <span className="tabular text-[11px] text-muted-foreground">{profile.email}</span>
      <span className="text-[11px] text-muted-foreground">{profile.descripcion}</span>
    </button>
  );
}

interface DemoProfilesPanelProps {
  /** Blocks every row while the form is submitting or the account is locked. */
  disabled?: boolean;
  /** True while the typewriter is filling the form for the selected profile. */
  busy?: boolean;
  /** Extra control rendered next to the collapse button (the theme toggle). */
  headerAction?: ReactNode;
  /** Selecting a profile only fills the form; the caller still posts /api/v1/sesiones. */
  onSelect: (profile: DemoUser) => void;
}

/**
 * Collapsible list of the seeded demo profiles. It never authenticates by
 * itself: clicking a row asks the page to type the credentials into the real
 * form and submit it, so the server stays the single source of truth.
 */
export function DemoProfilesPanel({
  disabled = false,
  busy = false,
  headerAction,
  onSelect,
}: DemoProfilesPanelProps) {
  const [open, setOpen] = useState(true);
  const [expandedRoles, setExpandedRoles] = useState<Record<string, boolean>>({});
  const bodyId = useId();

  const toggleRole = (rol: DemoUser['rol']) => {
    setExpandedRoles((current) => ({ ...current, [rol]: !current[rol] }));
  };

  return (
    <div
      aria-busy={busy}
      className="w-[19rem] max-w-[calc(100vw-1.5rem)] rounded-lg border border-border bg-card text-card-foreground shadow-sm"
    >
      <div className="flex items-center gap-0.5 p-1">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((current) => !current)}
          className={TOGGLE_CLASS}
        >
          <Users className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="nv-label truncate text-muted-foreground">Perfiles demo</span>
          {busy && (
            <span role="status" className="truncate text-[10px] text-muted-foreground">
              Rellenando…
            </span>
          )}
          <ChevronDown
            aria-hidden
            className={cn(
              'ml-auto size-3.5 shrink-0 text-muted-foreground transition-transform',
              open && 'rotate-180',
            )}
          />
        </button>
        {headerAction}
      </div>

      {open && (
        <div
          id={bodyId}
          className="flex max-h-[min(62dvh,28rem)] flex-col gap-0.5 overflow-y-auto border-border border-t p-1"
        >
          {PROFILE_GROUPS.map((group) => {
            const [first] = group.profiles;
            if (group.profiles.length === 1) {
              return (
                <ProfileRow
                  key={first.email}
                  profile={first}
                  disabled={disabled}
                  onSelect={onSelect}
                />
              );
            }

            const groupOpen = expandedRoles[group.rol] ?? false;
            const groupId = `${bodyId}-${group.rol}`;
            return (
              <div key={group.rol} className="flex flex-col gap-0.5">
                <button
                  type="button"
                  aria-expanded={groupOpen}
                  aria-controls={groupId}
                  onClick={() => toggleRole(group.rol)}
                  className={ROW_CLASS}
                >
                  <span className="flex items-center gap-1.5">
                    <ChevronRight
                      aria-hidden
                      className={cn(
                        'size-3.5 shrink-0 text-muted-foreground transition-transform',
                        groupOpen && 'rotate-90',
                      )}
                    />
                    <span className="font-medium text-xs">{first.groupLabel ?? first.label}</span>
                    <span className="tabular text-[11px] text-muted-foreground">
                      ({group.profiles.length})
                    </span>
                  </span>
                </button>
                {groupOpen && (
                  <div id={groupId} className="flex flex-col gap-0.5 pl-3">
                    {group.profiles.map((profile) => (
                      <ProfileRow
                        key={profile.email}
                        profile={profile}
                        disabled={disabled}
                        onSelect={onSelect}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
