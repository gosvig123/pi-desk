import importlib.util
import json
from pathlib import Path
import tempfile
import time
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('desk_sync',Path(__file__).parents[1]/'bin/desk-sync.py')
sync=importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)

class DeskSyncTest(unittest.TestCase):
    def test_references_are_bounded_cached_private_and_origin_owned(self):
        with tempfile.TemporaryDirectory() as directory:
            sync.AGENT=Path(directory)
            sync.STATE=sync.AGENT/'desk-sync'
            sessions=sync.AGENT/'sessions/project'
            sessions.mkdir(parents=True)
            file=sessions/'test.jsonl'
            sid='a'*32
            records=[dict(type='session',id=sid,cwd='/tmp'),dict(type='session_info',name='Named work'),dict(type='message',message={'content':'PRIVATE SECRET'})]
            file.write_text('\n'.join(map(json.dumps,records))+'\n')
            config=dict(origin='mac')
            first=sync.snapshot(config)
            self.assertEqual(first['sessions'][0]['title'],'Named work')
            self.assertNotIn('PRIVATE SECRET',json.dumps(first))
            self.assertEqual(sync.snapshot(config)['sessions'],first['sessions'])
            sync.atomic(sync.AGENT/'pisesh-meta.json',{'overrides':{sid:{'title':'Override'}}})
            self.assertEqual(sync.snapshot(config)['sessions'][0]['title'],'Override')
            sync.atomic(sync.AGENT/'pisesh-meta.json',{'overrides':{}})
            self.assertEqual(sync.snapshot(config)['sessions'][0]['title'],'Named work')
            with self.assertRaises(ValueError):sync.validate(first,'devbox')
            bad=dict(first,sessions=first['sessions']*501)
            with self.assertRaises(ValueError):sync.validate(bad,'mac')
            bad=json.loads(json.dumps(first));bad['sessions'][0]['file']='/tmp/a\n.jsonl'
            with self.assertRaises(ValueError):sync.validate(bad,'mac')
            sync.atomic(sync.STATE/'peer.json',dict(first,receivedAt=time.time()))
            old=(sync.STATE/'peer.json').read_bytes()
            config.update(sshHost='-bad',peerOrigin='devbox')
            with self.assertRaises(ValueError):sync.exchange(config)
            self.assertEqual((sync.STATE/'peer.json').read_bytes(),old)
            self.assertEqual((sync.STATE/'peer.json').stat().st_mode & 0o777,0o600)
            file.unlink()
            self.assertEqual(sync.snapshot({'origin':'mac'})['sessions'],[])

    def test_tick_results_export_only_bounded_final_replies(self):
        with tempfile.TemporaryDirectory() as directory:
            sync.AGENT=Path(directory)
            sync.STATE=sync.AGENT/'desk-sync'
            tick=sync.AGENT/'tick'
            (tick/'runs').mkdir(parents=True)
            transcript=tick/'runs/run.jsonl'
            transcript.write_text('\n'.join(map(json.dumps,[
                dict(type='message',message=dict(role='user',content='PRIVATE PROMPT')),
                dict(type='message',message=dict(role='assistant',content=[dict(type='text',text='Final reply\nSecond line')]))
            ]))+'\n')
            row=dict(jobId='daily-check',runId='run-one',finishedAt='2026-09-18T07:00:00Z',exitCode=0,
                     transcriptPath=str(transcript),finalTextPreview='Preview',prompt='PRIVATE JOB')
            (tick/'runs.jsonl').write_text(json.dumps(row)+'\n')
            snapshot=sync.snapshot(dict(origin='devbox'))
            self.assertEqual(snapshot['ticks'][0]['text'],'Final reply\nSecond line')
            self.assertNotIn('PRIVATE',json.dumps(snapshot))
            self.assertNotIn('transcriptPath',snapshot['ticks'][0])
            self.assertEqual(sync.validate(snapshot,'devbox')['ticks'],snapshot['ticks'])
            legacy=dict(snapshot);del legacy['ticks']
            self.assertEqual(sync.validate(legacy,'devbox')['ticks'],[])
            bad=dict(snapshot,ticks=[dict(snapshot['ticks'][0],outcome='unknown')])
            with self.assertRaises(ValueError):sync.validate(bad,'devbox')
            row['transcriptPath']=str(sync.AGENT/'outside.jsonl')
            (sync.AGENT/'outside.jsonl').write_text(transcript.read_text())
            (tick/'runs.jsonl').write_text(json.dumps(row)+'\n')
            self.assertEqual(sync.snapshot(dict(origin='devbox'))['ticks'][0]['text'],'Preview')
            (tick/'runs.jsonl').write_text('\n'.join(json.dumps(dict(row,runId=f'run-{i}',finalTextPreview='界'*9000)) for i in range(120)))
            bounded=sync.snapshot(dict(origin='devbox'))
            self.assertLessEqual(len(bounded['ticks']),100)
            self.assertLessEqual(len(json.dumps(bounded['ticks']).encode()),256*1024)

    def test_overlapping_service_run_does_no_work(self):
        with tempfile.TemporaryDirectory() as directory:
            sync.AGENT=Path(directory)
            sync.STATE=sync.AGENT/'desk-sync'
            sync.atomic(sync.STATE/'config.json',{'origin':'mac','peerOrigin':'devbox'})
            with open(sync.STATE/'run.lock','a') as lock:
                sync.fcntl.flock(lock,sync.fcntl.LOCK_EX|sync.fcntl.LOCK_NB)
                with patch.object(sync,'snapshot') as scan, patch.object(sync,'sync_tasks') as tasks:
                    sync.main()
                    scan.assert_not_called()
                    tasks.assert_not_called()

    def test_failed_tasks_back_off_but_local_edits_retry(self):
        with tempfile.TemporaryDirectory() as directory:
            sync.AGENT=Path(directory)
            sync.STATE=sync.AGENT/'desk-sync'
            sync.atomic(sync.STATE/'config.json',{'origin':'mac','peerOrigin':'devbox'})
            with patch.object(sync,'sync_tasks',side_effect=sync.TaskSyncConflict()) as run, patch.object(sync,'task_fingerprint',return_value='unchanged'):
                sync.main()
                sync.main()
                self.assertEqual(run.call_count,1)
                status=sync.read_json(sync.STATE/'status.json',{})['tasks']
                self.assertEqual(status['error'],'TaskSyncConflict')
                self.assertEqual(status['retryDelay'],60)
                with patch.object(sync,'task_fingerprint',return_value='changed'):
                    sync.main()
                self.assertEqual(run.call_count,2)

if __name__=='__main__':unittest.main()
