# Local only, sourced. One end to end run on this Mac at a time (USH-310): two
# checks at once overloaded the host, timed out unit tests and crashed the dev
# server. A directory is the lock, because mkdir either makes it or fails, in
# one step. The holder's PID sits inside, so a waiter can name it, and a lock
# whose holder died is taken over.
#
# e2e_lock takes it, waiting at most USHABTI_LOCK_WAIT seconds (20 minutes).
# e2e_unlock gives it back; the caller runs it from its EXIT trap.

lock_dir=${USHABTI_LOCK_DIR:-$HOME/.local/state/ushabti}/e2e.lock
lock_wait=${USHABTI_LOCK_WAIT:-1200}
lock_mine=""

e2e_lock() {
  mkdir -p "$(dirname "$lock_dir")"
  waited=0
  said=""
  empty=0
  while ! mkdir "$lock_dir" 2>/dev/null; do
    holder=$(cat "$lock_dir/pid" 2>/dev/null || true)
    what=$(cat "$lock_dir/what" 2>/dev/null || true)
    if [ -z "$holder" ]; then
      # The holder makes the directory and then writes its PID. A directory
      # still empty after five seconds was left by a run that died in between.
      empty=$((empty + 1))
      if [ "$empty" -gt 5 ]; then
        echo "lock: $lock_dir names no holder; taking it over"
        rm -rf "$lock_dir"
        continue
      fi
    elif ! kill -0 "$holder" 2>/dev/null; then
      echo "lock: $lock_dir was held by PID $holder ($what), which is not alive; taking it over"
      rm -rf "$lock_dir"
      continue
    else
      empty=0
      if [ "$said" != "$holder" ]; then
        echo "lock: waiting for $lock_dir, held by PID $holder ($what)"
        said=$holder
      fi
    fi
    if [ "$waited" -ge "$lock_wait" ]; then
      if [ "$lock_wait" -ge 60 ]; then long="$((lock_wait / 60)) minutes"; else long="${lock_wait}s"; fi
      echo "lock: gave up after $long; $lock_dir is held by PID ${holder:-unknown} ($what)" >&2
      return 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
  echo "$$" >"$lock_dir/pid"
  echo "${1:-$0}" >"$lock_dir/what"
  lock_mine=1
  [ "$waited" -eq 0 ] || echo "lock: took $lock_dir after ${waited}s"
}

e2e_unlock() {
  [ -n "$lock_mine" ] || return 0
  # Only our own: a run that outlived its lock must not free the next holder's.
  if [ "$(cat "$lock_dir/pid" 2>/dev/null || true)" = "$$" ]; then rm -rf "$lock_dir"; fi
  lock_mine=""
}
