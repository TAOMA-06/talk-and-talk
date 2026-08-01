-- Support the serialized, per-participant auxiliary-event cap without scanning
-- unrelated provider facts or other participants in the voice session.
CREATE INDEX "VoiceAttendanceEvent_session_participant_source_received_idx"
ON "VoiceAttendanceEvent"("voiceSessionId", "participantUserId", "source", "serverReceivedAt");
