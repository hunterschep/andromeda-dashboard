from __future__ import annotations

from andromeda_dashboard.normalizers import (
    normalize_gpu_pools,
    normalize_history,
    normalize_nodes,
    normalize_partitions,
    normalize_queue,
    parse_duration_seconds,
    parse_gpu_inventory,
    parse_gpu_requests,
    parse_memory_mb,
    parse_sacctmgr_assoc,
    parse_sacctmgr_qos,
    parse_sdiag,
    parse_sprio_jobs,
    parse_sprio_weights,
    parse_storage_quota,
)


def test_parse_gres_variants():
    a100 = parse_gpu_inventory("gpu:a100:4", "gpu:a100:2(IDX:0-1)")
    assert a100[0].type == "a100"
    assert a100[0].total == 4
    assert a100[0].used == 2
    assert a100[0].free == 2

    h200 = parse_gpu_inventory("gpu:h200:8(S:0-1)", "gres/gpu:1")
    assert h200[0].type == "h200"
    assert h200[0].total == 8
    assert h200[0].used == 1

    generic = parse_gpu_requests("gres/gpu:1")
    assert generic[0].type == "generic"
    assert generic[0].count == 1

    mixed = parse_gpu_inventory("gpu:l40s:4,gpu:a10:2", "")
    assert {gpu.type: gpu.total for gpu in mixed} == {"a10": 2, "l40s": 4}

    assert parse_gpu_inventory("", "") == []


def test_memory_and_duration_parsers():
    assert parse_memory_mb("64G") == 65536
    assert parse_memory_mb("1T") == 1048576
    assert parse_duration_seconds("1-02:03:04") == 93784
    assert parse_duration_seconds("12:00:00") == 43200


def test_normalize_nodes_gpu_pools_and_partitions(load_json):
    nodes = normalize_nodes(load_json("nodes.json"))
    assert len(nodes) == 4
    assert nodes[0].name == "cpu001"
    assert nodes[0].is_available is True
    assert nodes[1].gpu_free == 2
    assert nodes[2].is_available is False

    pools = normalize_gpu_pools(nodes)
    assert {pool.type: pool.total for pool in pools} == {"a10": 2, "a100": 4, "h200": 8, "l40s": 4}
    assert next(pool for pool in pools if pool.type == "h200").usable == 0

    partitions = normalize_partitions(load_json("partitions.json"), nodes)
    short = next(partition for partition in partitions if partition.name == "short")
    assert short.total_nodes == 3
    assert short.cpus_idle == 124
    assert short.gpu_free == 8
    assert any("CPU, 44 core, 180GB" in item for item in short.node_classes)


def test_queue_privacy_scope_and_reason_labels(load_json):
    queue = normalize_queue(
        load_json("queue.json"),
        load_json("starts.json"),
        scope="cluster",
        current_user="hunterschep",
        lab_users=["labmate"],
        debug=False,
    )
    assert len(queue.jobs) == 3
    assert queue.running == 1
    assert queue.pending == 2

    lab_job = next(job for job in queue.jobs if job.job_id == "102")
    assert lab_job.reason_label == "Waiting for requested CPUs, memory, GPUs, or nodes to free up"
    assert lab_job.estimated_start_time is not None
    assert lab_job.qos == "normal"
    assert lab_job.constraints == ["large-mem", "rome"]
    assert lab_job.required_nodes == ["cpu001"]

    private_job = next(job for job in queue.jobs if job.job_id == "103")
    assert private_job.anonymized is True
    assert private_job.user.startswith("user-")
    assert private_job.name is None
    assert private_job.qos == "int"
    assert private_job.reservation == "course"
    assert private_job.licenses == ["matlab:1"]

    mine = normalize_queue(
        load_json("queue.json"),
        load_json("starts.json"),
        scope="mine",
        current_user="hunterschep",
        lab_users=["labmate"],
        debug=False,
    )
    assert [job.job_id for job in mine.jobs] == ["101"]


def test_history_and_text_parsers(load_json, load_text):
    history = normalize_history(load_json("history.json"), days=7, debug=False)
    assert history.median_wait_seconds == 900
    assert history.median_runtime_seconds == 2700
    assert history.jobs[1].name == "failed-gpu"
    assert history.jobs[1].max_rss_mb == 7168
    assert history.jobs[1].total_cpu_seconds == 480
    assert history.jobs[1].tres_usage_in_ave["gres/gpuutil"] == "6"
    assert "submit_line" not in history.jobs[1].model_dump()

    qos = parse_sacctmgr_qos(load_text("qos.txt"))
    assert qos[0].name == "normal"
    assert qos[0].max_jobs_per_user == 2000
    assert qos[1].max_tres_per_user["gres/gpu"] == "1"

    assoc = parse_sacctmgr_assoc(load_text("assoc.txt"))
    assert assoc.user == "hunterschep"
    assert assoc.account == "lab"

    scheduler = parse_sdiag(load_text("sdiag.txt"))
    assert scheduler.last_cycle_seconds == 0.25
    assert scheduler.mean_cycle_seconds == 1.5
    assert scheduler.backfill_last_depth == 120
    assert scheduler.queue_depth == 55

    weights = parse_sprio_weights(load_text("sprio.txt"))
    assert weights["fairshare"] == 10000
    assert weights["tres"] == 5000
    priority_jobs = parse_sprio_jobs(load_text("sprio.txt"))
    assert priority_jobs[0].job_id == "102"
    assert priority_jobs[0].dominant_factor == "fairshare"
    assert priority_jobs[1].tres == 60

    storage = parse_storage_quota(load_text("storage.txt"))
    assert storage.volumes[1].name == "scratch"
    assert storage.volumes[1].percent_used == 96
    assert storage.volumes[1].severity == "critical"


def test_storage_parser_ignores_acct_chk_identity_noise():
    raw = """
Pinky output:
Login  name:  scheppat  In  real  life:  Hunter  M  Scheppat  Directory:  /home/scheppat  Shell:  /bin/bash
uid=11255(scheppat)  gid=11255(scheppat)  groups=11255(scheppat),1529(prudlab)
drwx------  1  scheppat  scheppat  0  May  6  16:58  /home/scheppat

User level disk usage
OWNER     PATH               USED     SOFT_LIMIT  HARD_LIMIT  USAGE_%  GRACE_PERIOD  TIME_OVER_SOFT_LIMIT  STATUS
scheppat  /home/scheppat     31.25GB  45.00GB     50.00GB     69       14d_0:00:00h  0.00s                 ACTIVE
scheppat  /scratch/scheppat  1.15TB   1TB         25TB        115      7d_0:00:00h   6:58:12h              ACTIVE

Group level disk usage for the specified group(s)
GROUP    POSIX       OWNER     PATH               USED    SOFT_LIMIT  HARD_LIMIT  USAGE_%  GRACE_PERIOD  TIME_OVER_SOFT_LIMIT  STATUS
prudlab  drwxrws---  prudhome  /projects/prudlab  3.89TB  10TB        25TB        38       14d_0:00:00h  0.00s                 ACTIVE
"""
    storage = parse_storage_quota(raw)

    assert [volume.name for volume in storage.volumes] == ["home", "scratch", "projects"]
    scratch = storage.volumes[1]
    assert scratch.path == "/scratch/scheppat"
    assert scratch.quota_gb == 1024
    assert scratch.percent_used == 115
    assert scratch.severity == "critical"


def test_live_slurm_nested_values_are_normalized():
    queue = normalize_queue(
        {
            "jobs": [
                {
                    "job_id": 2290647,
                    "name": "Jupyter",
                    "user_name": "someuser",
                    "account": "lab",
                    "partition": "long",
                    "job_state": ["RUNNING"],
                    "state_reason": "None",
                    "cpus": {"infinite": False, "number": 62, "set": True},
                    "memory_per_node": {"infinite": False, "number": 59392, "set": True},
                    "tres_req_str": "cpu=62,mem=58G,node=1",
                    "start_time": {"infinite": False, "number": 1775787201, "set": True},
                    "submit_time": {"infinite": False, "number": 1775787199, "set": True},
                    "end_time": {"infinite": False, "number": 1778379201, "set": True},
                    "time_limit": {"infinite": False, "number": 2880, "set": True},
                    "priority": {"infinite": False, "number": 863688, "set": True},
                    "nodes": "cht006",
                }
            ]
        },
        {"jobs": []},
        scope="cluster",
        current_user="someuser",
        lab_users=[],
        debug=True,
    )
    assert queue.jobs[0].state == "RUNNING"
    assert queue.jobs[0].cpus == 62
    assert queue.jobs[0].memory_mb == 59392
    assert queue.jobs[0].time_limit_seconds == 172800
    assert queue.jobs[0].start_time is not None

    history = normalize_history(
        {
            "jobs": [
                {
                    "job_id": 2419328,
                    "state": {"current": ["COMPLETED"], "reason": "None"},
                    "exit_code": {
                        "return_code": {"infinite": False, "number": 0, "set": True},
                        "signal": {
                            "id": {"infinite": False, "number": 0, "set": False},
                            "name": "",
                        },
                    },
                    "submit_time": {"infinite": False, "number": 1775787199, "set": True},
                    "start_time": {"infinite": False, "number": 1775787201, "set": True},
                    "end_time": {"infinite": False, "number": 1775787301, "set": True},
                }
            ]
        },
        days=7,
    )
    assert history.jobs[0].state == "COMPLETED"
    assert history.jobs[0].exit_code == "0:0"
    assert history.jobs[0].wait_seconds == 2

    timed_history = normalize_history(
        {
            "jobs": [
                {
                    "job_id": 2419328,
                    "user": "scheppat",
                    "state": {"current": ["COMPLETED"], "reason": "None"},
                    "time": {
                        "elapsed": 22046,
                        "end": 1777542222,
                        "start": 1777520176,
                        "submission": 1777517681,
                    },
                }
            ]
        },
        days=7,
    )
    assert timed_history.jobs[0].wait_seconds == 2495
    assert timed_history.jobs[0].runtime_seconds == 22046
    assert timed_history.median_wait_seconds == 2495
