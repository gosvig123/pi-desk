#!/usr/bin/env python3
"""Private, bounded conversation references; task content stays in tasks-go."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time

AGENT = Path(os.environ.get('PI_CODING_AGENT_DIR', Path.home() / '.pi/agent'))
STATE = AGENT / 'desk-sync'
LIMIT = 500
MAX_BYTES = 1024 * 1024
ID = re.compile(r'^[a-fA-F0-9-]{32,36}$')


class TaskSyncConflict(Exception):
    """Resolve the source-list conflict with tasks-go; never adopt/force automatically."""


def read_json(file, default):
    try:
        if file.stat().st_size > MAX_BYTES:
            raise ValueError('JSON exceeds limit')
        return json.loads(file.read_text())
    except FileNotFoundError:
        return default


def atomic(file, data):
    file.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    raw = json.dumps(data, ensure_ascii=True).encode()
    if len(raw) > MAX_BYTES:
        raise ValueError('snapshot exceeds limit')
    fd, tmp = tempfile.mkstemp(dir=file.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(raw)
        os.replace(tmp, file)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)


def text(value, limit=256):
    return ''.join(c for c in str(value or '') if c.isprintable())[:limit]


def validate(data, origin):
    if not isinstance(data, dict) or data.get('version') != 1 or data.get('origin') != origin:
        raise ValueError('unexpected reference origin/version')
    rows = data.get('sessions')
    if not isinstance(rows, list) or len(rows) > LIMIT:
        raise ValueError('invalid reference count')
    clean = []
    for row in rows:
        if not isinstance(row, dict) or not ID.fullmatch(str(row.get('id', ''))):
            raise ValueError('invalid session ID')
        file, cwd = row.get('file'), row.get('cwd')
        if not isinstance(file, str) or not file.startswith('/') or not file.endswith('.jsonl') or len(file) > 2048 or any(ord(c)<32 for c in file):
            raise ValueError('invalid session path')
        if not isinstance(cwd, str) or not cwd.startswith('/') or len(cwd)>2048 or any(ord(c)<32 for c in cwd):
            raise ValueError('invalid working directory')
        mtime = row.get('mtime')
        if not isinstance(mtime, (float,int)) or not 0 <= mtime <= time.time()+86400:
            raise ValueError('invalid timestamp')
        task = row.get('task')
        if task is not None:
            if not isinstance(task,dict) or not ID.fullmatch(str(task.get('id',''))):
                raise ValueError('invalid task link')
            task = {k:text(task.get(k)) for k in ('id','title','list')}
        clean.append(dict(id=row['id'], file=file, cwd=cwd, title=text(row.get('title')), mtime=mtime, task=task))
    generated = data.get('generatedAt')
    if not isinstance(generated,(float,int)) or not 0 <= generated <= time.time()+86400:
        raise ValueError('invalid snapshot timestamp')
    return dict(version=1, origin=origin, generatedAt=generated, sessions=clean)


def snapshot(config):
    root = AGENT / 'sessions'
    cache = read_json(STATE / 'scan-cache.json', {})
    meta = read_json(AGENT / 'pisesh-meta.json', {}).get('overrides', {})
    links = read_json(AGENT / 'pisesh-task-links.json', {}).get('links', {})
    candidates = []
    # ponytail: scan at most 20k directory entries; use an index if history exceeds this ceiling.
    seen = 0
    if root.exists():
        for directory, dirs, files in os.walk(root, followlinks=False):
            dirs[:] = sorted(d for d in dirs if not d.startswith('.') and Path(directory)==root)
            for name in files:
                seen += 1
                if seen > 20000:
                    raise ValueError('session scan exceeds 20k entries; previous references retained')
                file = Path(directory)/name
                if file.suffix != '.jsonl' or file.is_symlink():
                    continue
                try:
                    stat = file.stat()
                    candidates.append((stat.st_mtime, str(file), stat.st_size))
                except FileNotFoundError:
                    continue
    rows, next_cache = [], {}
    for mtime, name, size in sorted(candidates, reverse=True)[:LIMIT]:
        key = f'{mtime}:{size}'
        previous = cache.get(name, {})
        if previous.get('key') == key:
            row = previous['row'].copy()
        else:
            try:
                with open(name,'rb') as stream:
                    first = stream.readline(8192)
                    if not first.endswith(b'\n'):
                        continue
                    header = json.loads(first)
                    if header.get('type')!='session' or not ID.fullmatch(str(header.get('id',''))):
                        continue
                    # Read only the tail for /name, never copy messages or tool output.
                    head = stream.read(65536).splitlines()
                    stream.seek(max(len(first),size-65536))
                    tail = head + stream.read(65536).splitlines()
                title = previous.get('row',{}).get('title','')
                for line in tail:
                    try:
                        entry=json.loads(line)
                        if entry.get('type')=='session_info': title=text(entry.get('name'))
                    except (ValueError,UnicodeError):
                        pass
                row=dict(id=header['id'],cwd=header.get('cwd',''),file=name,title=title,mtime=mtime,task=None)
            except (FileNotFoundError,ValueError,UnicodeError):
                continue
        next_cache[name]=dict(key=key,row=row.copy())
        override=meta.get(row['id'],{})
        row['title']=text(override.get('title') or row['title'])
        row['cwd']=override.get('cwd') or row['cwd']
        row['task']=links.get(row['id'])
        rows.append(row)
    result=validate(dict(version=1,origin=config['origin'],generatedAt=time.time(),sessions=rows),config['origin'])
    atomic(STATE/'scan-cache.json',next_cache)
    atomic(STATE/'local.json',result)
    return result


def exchange(config):
    own=read_json(STATE/'local.json',None)
    validate(own,config['origin'])
    if not config.get('sshHost'):
        return
    # SSH command comes only from private local config, never from received metadata.
    host=config['sshHost']
    if not re.fullmatch(r'[A-Za-z0-9_.@-]+',host) or host.startswith('-'):
        raise ValueError('invalid SSH host')
    import shlex
    command=' '.join(shlex.quote(s) for s in [config['remotePython'], config['remoteScript'], 'exchange'])
    result=subprocess.run(['ssh','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=5','-o','ServerAliveInterval=5','-o','ServerAliveCountMax=1',host,command],input=json.dumps(own).encode(),stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,timeout=20,check=True)
    if len(result.stdout)>MAX_BYTES:
        raise ValueError('peer snapshot exceeds limit')
    peer=validate(json.loads(result.stdout),config['peerOrigin'])
    atomic(STATE/'peer.json',dict(**peer,receivedAt=time.time()))


def main():
    config=read_json(STATE/'config.json',None)
    if not config:
        raise ValueError('desk-sync is not configured')
    if sys.argv[1:] == ['exchange']:
        data=sys.stdin.buffer.read(MAX_BYTES+1)
        if len(data)>MAX_BYTES: raise ValueError('input exceeds limit')
        peer=validate(json.loads(data),config['peerOrigin'])
        own=validate(read_json(STATE/'local.json',None),config['origin'])
        atomic(STATE/'peer.json',dict(**peer,receivedAt=time.time()))
        print(json.dumps(own))
        return
    STATE.mkdir(parents=True,exist_ok=True,mode=0o700)
    with open(STATE/'run.lock','a') as lock:
        try: fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError: return
        status=read_json(STATE/'status.json',{})
        for name,operation in [('references',lambda:snapshot(config)),('transport',lambda:exchange(config)),('tasks',lambda:sync_tasks(config))]:
            previous=status.get(name,{})
            fingerprint=None
            try:
                if name=='tasks':
                    fingerprint=task_fingerprint()
                    if previous.get('fingerprint')==fingerprint and previous.get('retryAt',0)>time.time():
                        continue
                operation()
                status[name]=dict(ok=True,at=time.time())
            except Exception as error:
                # Never log peer data, tokens, task titles, or command stderr.
                status[name]=dict(ok=False,at=time.time(),error=type(error).__name__)
                if name=='tasks':
                    delay=min(300,previous.get('retryDelay',30)*2)
                    status[name].update(fingerprint=fingerprint,retryDelay=delay,retryAt=time.time()+delay)
        atomic(STATE/'status.json',status)


def task_fingerprint():
    entries=[]
    for file in sorted((Path.home()/'tasks-lists').glob('*.md')):
        stat=file.stat()
        entries.append((file.name,stat.st_size,stat.st_mtime_ns))
    return hashlib.sha256(repr(entries).encode()).hexdigest()


def sync_tasks(config):
    # Let tasks-go finish its locked write transaction; only Git's network I/O times out.
    env=dict(os.environ,GIT_CONFIG_COUNT='2',GIT_CONFIG_KEY_0='http.lowSpeedLimit',GIT_CONFIG_VALUE_0='1',GIT_CONFIG_KEY_1='http.lowSpeedTime',GIT_CONFIG_VALUE_1='20',GIT_TERMINAL_PROMPT='0')
    with tempfile.TemporaryFile() as errors:
        result=subprocess.run([config['tasks'],'sync','--no-prune'],env=env,stdout=subprocess.DEVNULL,stderr=errors)
        if result.returncode:
            errors.seek(0)
            if b'sync conflict' in errors.read(8192):
                raise TaskSyncConflict()
            raise subprocess.CalledProcessError(result.returncode,'tasks sync --no-prune')


if __name__=='__main__':
    try: main()
    except Exception as error:
        print('desk-sync: '+type(error).__name__,file=sys.stderr)
        sys.exit(1)
