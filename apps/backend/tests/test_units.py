import pytest
from pydantic import ValidationError

from aftercall.ingest import MAX_AUDIO_BYTES, UploadError, check_audio, is_audio, parse_upload, read_upload
from aftercall.jev import normalize
from aftercall.planner import estimate, is_over_limit, plan_requests
from aftercall.signals import Condition, SignalSpec, TrackerSpec, jev_key
from aftercall.tokens import REQUEST_OVERHEAD

CHOICE = {"name": "outcome", "type": "choice", "instructions": "Outcome?",
          "criteria": {"booked": "Booked a slot", "other": "Anything else"}}


class TestSignalSpec:
    def test_valid_types(self):
        assert SignalSpec.model_validate(CHOICE).to_jev()["type"] == "choice"
        yn = SignalSpec(name="human", type="yes_no", instructions="Asked for a human?")
        assert yn.to_jev() == {"type": "noul", "instructions": "Asked for a human?"}
        sc = SignalSpec(name="mood", type="score", instructions="Mood?", criteria=["calm", "angry"])
        assert sc.to_jev()["criteria"] == ["calm", "angry"]

    @pytest.mark.parametrize(
        "patch, message",
        [
            ({"criteria": {"booked": "Booked", "declined": "No"}}, '"other"'),
            ({"criteria": {"booked": "", "other": "x"}}, "description"),
            ({"criteria": ["a", "b"]}, "object"),
            ({"instructions": "Contradicts {policy}?"}, "{policy}"),
            ({"name": "Bad Name"}, "pattern"),
        ],
    )
    def test_invalid_choice(self, patch, message):
        with pytest.raises(ValidationError, match=message.replace("{", r"\{").replace("}", r"\}")):
            SignalSpec.model_validate({**CHOICE, **patch})

    def test_score_levels(self):
        with pytest.raises(ValidationError, match="2-10"):
            SignalSpec(name="s", type="score", instructions="x", criteria=["only one"])
        with pytest.raises(ValidationError, match="2-10"):
            SignalSpec(name="s", type="score", instructions="x", criteria=[str(i) for i in range(11)])

    def test_yes_no_criteria_keys(self):
        with pytest.raises(ValidationError, match="true"):
            SignalSpec(name="y", type="yes_no", instructions="x", criteria={"maybe": "?"})


class TestTrackerSpec:
    def test_names(self):
        assert TrackerSpec(name="compliance", description="Policy checks").name == "compliance"
        with pytest.raises(ValidationError, match="__"):
            TrackerSpec(name="a__b")
        with pytest.raises(ValidationError, match="pattern"):
            TrackerSpec(name="Compliance")

    def test_jev_key_is_unique_per_tracker(self):
        assert jev_key("sales", "outcome") != jev_key("experience", "outcome")

    def test_condition_on_itself_is_rejected(self):
        with pytest.raises(ValidationError, match="another tracker"):
            TrackerSpec(name="retention", run_if={"tracker": "retention", "signal": "q", "op": "in", "value": ["x"]})


class TestCondition:
    def test_value_shape_follows_op(self):
        with pytest.raises(ValidationError, match="list"):
            Condition(tracker="a", signal="q", op="in", value=2)
        with pytest.raises(ValidationError, match="list"):
            Condition(tracker="a", signal="q", op="not_in", value=[])
        with pytest.raises(ValidationError, match="number"):
            Condition(tracker="a", signal="q", op="gte", value=["1"])

    def test_holds(self):
        declined = Condition(tracker="outcome", signal="call_outcome", op="in", value=["declined", "no_answer"])
        assert declined.holds("declined", None) and not declined.holds("booked", None)
        assert Condition(tracker="o", signal="q", op="not_in", value=["booked"]).holds("declined", None)
        angry = Condition(tracker="experience", signal="frustration", op="gte", value=2)
        assert angry.holds("2.40", 2.4) and not angry.holds("1.10", 1.1)
        assert Condition(tracker="e", signal="f", op="lte", value=1).holds("0.50", 0.5)
        assert declined.describe() == "outcome.call_outcome in [declined, no_answer]"
        assert angry.describe() == "experience.frustration >= 2"


class TestPlanner:
    def test_over_limit_is_strictly_above_budget(self):
        assert not is_over_limit(30_000, 30_000)
        assert is_over_limit(30_001, 30_000)

    def test_everything_fits_in_one_request(self):
        assert plan_requests(1000, {"x": {"a": 50, "b": 60}}, 30_000, 15) == [["a", "b"]]

    def test_splits_when_signals_overflow(self):
        transcript = 30_000 - REQUEST_OVERHEAD - 150
        plan = plan_requests(transcript, {"x": {"a": 100, "b": 100, "c": 40}}, 30_000, 15)
        assert sorted(sorted(p) for p in plan) == [["a", "c"], ["b"]]

    def test_signal_too_big_alone_still_sent(self):
        assert plan_requests(29_900, {"x": {"a": 500}}, 30_000, 15) == [["a"]]

    def test_signal_cap_keeps_trackers_together(self):
        groups = {c: {f"{c}__{i}": 10 for i in range(n)} for c, n in {"a": 8, "b": 6, "c": 5}.items()}
        plan = plan_requests(500, groups, 30_000, 15)
        assert all(len(p) <= 15 for p in plan) and sum(len(p) for p in plan) == 19
        # No tracker is split across requests: each fits under the cap on its own.
        for c in groups:
            assert sum(any(k.startswith(c) for k in p) for p in plan) == 1

    def test_tracker_over_the_cap_is_split(self):
        plan = plan_requests(500, {"big": {f"q{i}": 10 for i in range(20)}}, 30_000, 15)
        assert sorted(len(p) for p in plan) == [5, 15]

    def test_cap_and_stages_are_not_large(self):
        """Splitting for the signal cap or for conditions isn't flagged; only the token budget is."""
        many = {"a": {f"q{i}": 10 for i in range(20)}}
        est = estimate(500, [many, {"b": {"r": 10}}], 30_000, 15)
        assert est.requests == 3 and not est.is_large and est.multiplier == 1
        near = estimate(30_000 - REQUEST_OVERHEAD - 50, [many], 30_000, 15)  # room for 5 signals a request
        assert near.is_large and near.requests > near.unsplit_requests == 2 and near.multiplier > 1


class TestNormalize:
    def test_noul_confidence_from_distance_to_half(self):
        n = normalize({"type": "noul", "noul": 0.9})
        assert (n.value_text, round(n.confidence, 6)) == ("yes", 0.8)
        assert normalize({"type": "noul", "noul": 0.5}).confidence == 0

    def test_choice_and_score_pass_through(self):
        c = normalize({"type": "choice", "choice": "a", "confidence": 0.7, "probabilities": {"a": 0.9, "b": 0.1}})
        assert (c.value_text, c.confidence) == ("a", 0.7)
        s = normalize({"type": "score", "score": 1.43, "confidence": 0.4, "probabilities": {"0": 0, "1": 0.57, "2": 0.43}, "legend": {}})
        assert (s.value_num, s.value_text) == (1.43, "1.43")


class TestIngest:
    def test_json_turns_are_rendered(self):
        calls = parse_upload("x.json", b'{"calls":[{"external_id":7,"transcript":[{"speaker":"agent","text":"hi"},{"role":"user","content":"hello"}]}]}')
        assert calls[0].external_id == "7"
        assert calls[0].transcript == "agent: hi\nuser: hello"

    def test_csv_and_jsonl(self):
        assert parse_upload("x.csv", b"external_id,transcript\na,caller: namaste\n")[0].transcript == "caller: namaste"
        assert len(parse_upload("x.jsonl", b'{"transcript":"a"}\n{"transcript":"b"}\n')) == 2

    def test_row_errors_are_reported(self):
        with pytest.raises(UploadError) as exc:
            parse_upload("x.json", b'[{"transcript":"ok"},{"transcript":""},{"agent_id":"x"}]')
        assert [e.split(":")[0] for e in exc.value.errors] == ["row 2", "row 3"]

    def test_unsupported_extension(self):
        with pytest.raises(UploadError, match=".csv"):
            parse_upload("x.pdf", b"hello")

    def test_channel_and_metadata(self):
        csv = b"external_id,channel,meta.rep,transcript\na,WhatsApp,Meera,customer: hi\n"
        call = parse_upload("x.csv", csv)[0]
        assert (call.channel, call.metadata) == ("whatsapp", {"rep": "Meera"})
        with pytest.raises(UploadError, match="metadata key"):
            parse_upload("x.json", b'[{"transcript":"hi","metadata":{"Bad Key":"x"}}]')


class TestAudio:
    def test_audio_by_extension(self):
        assert is_audio("call.MP3") and is_audio("a.flac") and not is_audio("calls.csv") and not is_audio("")

    def test_mime_from_declared_type_or_extension(self):
        assert check_audio("c.mp3", "audio/mp3", b"x") == "audio/mpeg"
        assert check_audio("c.m4a", "application/octet-stream", b"x") == "audio/mp4"

    def test_rejects_empty_oversize_and_unknown(self):
        with pytest.raises(UploadError, match="empty"):
            check_audio("c.wav", "audio/wav", b"")
        with pytest.raises(UploadError, match="30 MB"):
            check_audio("c.wav", "audio/wav", b"x" * (MAX_AUDIO_BYTES + 1))
        with pytest.raises(UploadError, match="unsupported"):
            check_audio("c.aiff", "audio/aiff", b"x")


class TestFormats:
    """B51: transcripts in any layout."""

    def test_any_column_names(self):
        parsed = read_upload("x.csv", b"id,Conversation,date\nc-1,agent: hello,2026-09-20\n")
        call = parsed.calls[0]
        assert (call.external_id, call.transcript, call.started_at) == ("c-1", "agent: hello", "2026-09-20")
        assert parsed.format["adapter"] == "csv"

    def test_one_row_per_message(self):
        csv = b"conversation_id,speaker,text\n1,agent,Hello\n1,customer,Hi\n2,agent,Bye\n"
        parsed = read_upload("x.csv", csv)
        assert [c.transcript for c in parsed.calls] == ["agent: Hello\ncustomer: Hi", "agent: Bye"]
        assert parsed.format["adapter"] == "csv_turns"

    def test_plain_text_blocks(self):
        text = b"# Call 17\nAgent: hi\nCaller: hello\n---\n\n---\nAgent: second\n"
        parsed = read_upload("x.txt", text)
        assert [(c.external_id, c.transcript) for c in parsed.calls] == [("Call 17", "Agent: hi\nCaller: hello"), (None, "Agent: second")]
        assert parsed.skipped == [{"line": 5, "reason": "Nothing between the separators"}]
        assert read_upload("x.txt", b"just some words").warnings

    def test_vtt_and_srt(self):
        vtt = b"WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\n<v Priya>Hello there</v>\n\n00:00:03.000 --> 00:00:04.000\n<v Sam>Hi\n"
        call = read_upload("week38.vtt", vtt).calls[0]
        assert (call.external_id, call.transcript) == ("week38", "Priya: Hello there\nSam: Hi")
        srt = b"1\n00:00:01,000 --> 00:00:02,000\nAgent: one\n\n2\n00:00:03,000 --> 00:00:04,000\nCaller: two\n"
        assert read_upload("x.srt", srt).calls[0].transcript == "Agent: one\nCaller: two"
