import { DurableObject } from "cloudflare:workers";
import { GroupCore } from "./group.js";
import { handle } from "./handler.js";

const CLEANUP_EVERY = 6 * 3600 * 1000;

// Einn Durable Object per hópkóða. Allar staðsetningar hópsins búa í SQLite inni í honum.
export class Group extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.core = new GroupCore(ctx.storage.sql);
    this.alarmChecked = false;
  }
  async sync(body, since) {
    if (!this.alarmChecked) {
      this.alarmChecked = true;
      if ((await this.ctx.storage.getAlarm()) == null) await this.ctx.storage.setAlarm(Date.now() + CLEANUP_EVERY);
    }
    return this.core.sync(body, since);
  }
  state(since) {
    return this.core.state(since);
  }
  // Hreinsar gamlar slóðir nokkrum sinnum á dag; hættir þegar hópurinn er tómur
  async alarm() {
    const left = this.core.cleanup();
    if (left > 0) await this.ctx.storage.setAlarm(Date.now() + CLEANUP_EVERY);
    else await this.ctx.storage.deleteAll();
  }
}

export default {
  fetch(req, env, ctx) {
    return handle(req, env, ctx);
  },
};
