// ⌘K: jump to any page, tracker, signal or upload, or start something new.
// No open/close animation beyond the dialog's quick fade: it's used often.
import { BILLING_ON } from './config'
import { BookOpenText, Buildings, ChartBar, Coins, Desktop, FileText, FolderSimple, GearSix, Moon, Plus, PresentationChart, Pulse, SquaresFour, Sun, Table, UploadSimple, UserCircle, UsersThree } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { listDashboards, listProjects, listTrackers, listUploads, type Dashboard, type Project, type Tracker, type UploadStatus } from './api'
import { AlteriaMark } from './alteria'
import { switchProject } from './project'
import { Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from './components/ui/command'
import { can } from './access'
import { useMe } from './people'
import { title } from './lib/format'
import { setTheme } from './theme'

export function CommandMenu({ open, setOpen }: { open: boolean; setOpen: (o: boolean) => void }) {
  const navigate = useNavigate()
  const me = useMe().data
  const [data, setData] = useState<{ trackers: Tracker[]; uploads: UploadStatus[]; dashboards: Dashboard[]; projects: Project[] }>()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen(!open)
      }
    }
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [open, setOpen])

  useEffect(() => {
    if (open) Promise.all([listTrackers(), listUploads(), listDashboards().catch(() => []), listProjects().catch(() => [])]).then(([trackers, uploads, dashboards, projects]) => setData({ trackers, uploads, dashboards, projects }))
  }, [open])

  const run = (fn: () => void) => () => {
    setOpen(false)
    fn()
  }
  const go = (to: string) => run(() => navigate(to))

  return (
    <CommandDialog open={open} onOpenChange={setOpen} title="Search" description="Jump to a page, tracker, signal or upload" className="duration-100 data-closed:duration-75 sm:max-w-lg">
      <Command>
      <CommandInput placeholder="Search trackers, signals, uploads…" />
      <CommandList className="max-h-[min(24rem,60dvh)]">
        <CommandEmpty>Nothing matches.</CommandEmpty>
        <CommandGroup heading="Go to">
          <CommandItem onSelect={go('/insights')}><SquaresFour aria-hidden /> Insights</CommandItem>
          <CommandItem value="ask alteria chat question" onSelect={go('/ask')}><AlteriaMark /> Ask alteria</CommandItem>
          <CommandItem onSelect={go('/dashboards')}><PresentationChart aria-hidden /> Dashboards</CommandItem>
          {BILLING_ON && <CommandItem value="pricing plans upgrade pro pay as you go" onSelect={go('/pricing')}><ChartBar aria-hidden /> Plans and pricing</CommandItem>}
          {can(me, 'trackers.edit') && <CommandItem onSelect={go('/trackers')}><Pulse aria-hidden /> Trackers</CommandItem>}
          {can(me, 'analyse') && <CommandItem onSelect={go('/analyse')}><UploadSimple aria-hidden /> Analyse calls</CommandItem>}
          <CommandItem onSelect={go('/results')}><Table aria-hidden /> Results</CommandItem>
          <CommandItem value="settings account overview stats" onSelect={go('/settings')}><GearSix aria-hidden /> Settings</CommandItem>
          <CommandItem value="workspace name address domain join rename" onSelect={go('/settings/workspace')}><Buildings aria-hidden /> Workspace</CommandItem>
          <CommandItem value="team members teammates invite roles" onSelect={go('/settings/team')}><UsersThree aria-hidden /> Team</CommandItem>
          <CommandItem value="profile name notifications email" onSelect={go('/settings/profile')}><UserCircle aria-hidden /> Profile</CommandItem>
          {BILLING_ON && can(me, 'billing.view') && <CommandItem value="plan credits balance billing invoices" onSelect={go('/settings/credits')}><Coins aria-hidden /> Plan and credits</CommandItem>}
          {BILLING_ON && can(me, 'billing.manage') && <CommandItem value="add credits top up pay" onSelect={go('/settings/credits/add')}><Plus aria-hidden /> Add credits</CommandItem>}
          {can(me, 'usage.self') && <CommandItem onSelect={go('/settings/usage')}><ChartBar aria-hidden /> Usage</CommandItem>}
          {can(me, 'projects.manage') && <CommandItem onSelect={go('/projects')}><FolderSimple aria-hidden /> Projects</CommandItem>}
          <CommandItem value="docs help faq support privacy terms guide how to" onSelect={go('/docs')}><BookOpenText aria-hidden /> Docs and help</CommandItem>
          {can(me, 'trackers.edit') && <CommandItem value="import trackers guide json template prompt" onSelect={go('/docs/import-trackers')}><BookOpenText aria-hidden /> Importing trackers</CommandItem>}
        </CommandGroup>
        {can(me, 'trackers.edit') && <CommandGroup heading="Create">
          <CommandItem onSelect={go('/trackers/_new')}><Plus aria-hidden /> New tracker</CommandItem>
          {data?.trackers.filter((t) => t.active).map((t) => (
            <CommandItem key={t.name} value={`new signal in ${title(t.name)}`} onSelect={go(`/trackers/${t.name}/_new`)}>
              <Plus aria-hidden /> New signal in {title(t.name)}
            </CommandItem>
          ))}
        </CommandGroup>}
        {!!data?.trackers.length && (
          <CommandGroup heading="Signals">
            {data.trackers.flatMap((t) =>
              t.signals.map((s) => (
                <CommandItem key={`${t.name}.${s.name}`} value={`${title(s.name)} ${title(t.name)} ${s.name}`} onSelect={go(`/trackers/${t.name}/${s.name}`)}>
                  <Pulse aria-hidden /> {title(s.name)}
                  <CommandShortcut className="tracking-normal">{title(t.name)}</CommandShortcut>
                </CommandItem>
              )),
            )}
          </CommandGroup>
        )}
        {(data?.projects.length ?? 0) > 1 && (
          <CommandGroup heading="Switch project">
            {data!.projects.map((p) => (
              <CommandItem key={p.id} value={`switch project ${p.name}`} onSelect={run(() => { switchProject(p.id); navigate('/insights') })}>
                <FolderSimple aria-hidden /> {p.name}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {!!data?.dashboards.length && (
          <CommandGroup heading="Dashboards">
            {data.dashboards.map((d) => (
              <CommandItem key={d.id} value={`dashboard ${d.name}`} onSelect={go(`/dashboards/${d.id}`)}>
                <PresentationChart aria-hidden /> {d.name}
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        {!!data?.uploads.length && (
          <CommandGroup heading="Results">
            {data.uploads.map((u) => (
              <CommandItem key={u.upload_id} value={`${u.filename} ${u.upload_id}`} onSelect={go(`/results/${u.upload_id}`)}>
                <FileText aria-hidden /> {u.filename}
                <CommandShortcut className="tracking-normal">{new Date(u.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</CommandShortcut>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        <CommandSeparator />
        <CommandGroup heading="Theme">
          <CommandItem onSelect={run(() => setTheme('light'))}><Sun aria-hidden /> Light theme</CommandItem>
          <CommandItem onSelect={run(() => setTheme('dark'))}><Moon aria-hidden /> Dark theme</CommandItem>
          <CommandItem onSelect={run(() => setTheme('system'))}><Desktop aria-hidden /> Match system theme</CommandItem>
        </CommandGroup>
      </CommandList>
      </Command>
    </CommandDialog>
  )
}
