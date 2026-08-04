-- Keep the database state-machine allowlist aligned with the bounded erasure
-- phase that closes future booking boundaries before authentication erasure.
ALTER TABLE "AccountDeletionRequest"
DROP CONSTRAINT "AccountDeletionRequest_execution_phase_check";

ALTER TABLE "AccountDeletionRequest"
ADD CONSTRAINT "AccountDeletionRequest_execution_phase_check"
CHECK ("executionPhase" IN (
  'awaiting_second_review',
  'pending_customer_adult_eligibility',
  'notification_delivery',
  'notification',
  'subscription_grant',
  'recommendation_impression',
  'recommendation_request',
  'recommendation_tag',
  'recommendation_preference',
  'recommendation_exclusion',
  'availability_reminder_candidate',
  'availability_reminder_fanout_job',
  'companion_favorite',
  'companion_recent_view',
  'message_read_state',
  'conversation_notification_preference',
  'conversation_block',
  'future_booking_boundary',
  'refresh_token',
  'verification_code',
  'auth_identity',
  'staff_credential',
  'user_profile',
  'companion_availability_deactivate',
  'companion_availability_window',
  'recurring_window_detach',
  'companion_recurring_rule',
  'companion_blackout',
  'companion_recommendation_policy',
  'community_like',
  'community_report',
  'authored_post_like',
  'authored_post_report',
  'community_post',
  'review',
  'rating_refresh',
  'order_service_offering_detach',
  'companion_offering',
  'companion_service_tag',
  'companion_profile',
  'media_retention',
  'retained_transactions_snapshot',
  'retained_safety_snapshot',
  'retained_governance_snapshot',
  'final_verification',
  'completed'
)) NOT VALID;

ALTER TABLE "AccountDeletionRequest"
VALIDATE CONSTRAINT "AccountDeletionRequest_execution_phase_check";
