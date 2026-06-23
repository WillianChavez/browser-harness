import { connect, cdpReachable, listTabs, getActiveTarget } from '../session.js';
import { loadConfig } from '../config.js';
import { emit } from '../output.js';

export async function start(args, flags) {
  const { launched, version } = await connect({ allowLaunch: true });
  emit(
    flags,
    { launched, browser: version?.Browser, cdpUrl: loadConfig().cdpUrl },
    (d) => `${d.launched ? 'Chrome lanzado y' : 'Conectado a'} ${d.browser} (${d.cdpUrl})`
  );
}

export async function status(args, flags) {
  const cfg = loadConfig();
  const version = await cdpReachable(cfg);
  if (!version) {
    emit(flags, { running: false, cdpUrl: cfg.cdpUrl }, () => `no conectado (${cfg.cdpUrl})`);
    return;
  }
  const { browser } = await connect({ allowLaunch: false });
  const tabs = await listTabs(browser);
  emit(
    flags,
    {
      running: true,
      browser: version.Browser,
      cdpUrl: cfg.cdpUrl,
      tabCount: tabs.length,
      activeTargetId: getActiveTarget(),
    },
    (d) => `running: ${d.browser}\ncdp: ${d.cdpUrl}\ntabs: ${d.tabCount}\nactiva: ${d.activeTargetId || '(última)'}`
  );
}

export async function stop(args, flags) {
  const version = await cdpReachable();
  if (!version) {
    emit(flags, { stopped: false, reason: 'no estaba corriendo' }, () => 'no estaba corriendo');
    return;
  }
  const { browser } = await connect({ allowLaunch: false });
  await browser.close();
  emit(flags, { stopped: true }, () => 'navegador cerrado');
}
