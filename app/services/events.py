"""Calendar rules and commit-before-email confirmation."""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, date, datetime, time
from uuid import UUID

from app.core.config import Settings
from app.core.logging import get_logger
from app.domain.accounts import UserAccount
from app.models.events import CalendarEventModel
from app.repositories.events import EventRepository
from app.services.event_mail import EventMailer, EventMailError

logger = get_logger("services.events")


class EventValidationError(ValueError):
    """A calendar value cannot be accepted."""


class EventNotFoundError(LookupError):
    """Missing and unowned events have the same response."""


class EventConflictError(ValueError):
    """A cancelled event cannot be confirmed."""


class EventService:
    def __init__(
        self,
        repository: EventRepository,
        settings: Settings,
        mailer: EventMailer | None,
        commit: Callable[[], None],
    ) -> None:
        self._repository = repository
        self._settings = settings
        self._mailer = mailer
        self._commit = commit

    def _validate_schedule(self, event_date: date, event_time: time | None) -> None:
        zone = self._settings.calendar_zone
        # Untimed events begin at midnight in the configured calendar timezone.
        scheduled = datetime.combine(event_date, event_time or time.min, tzinfo=zone)
        now = datetime.now(zone)
        if scheduled.astimezone(UTC) <= now.astimezone(UTC):
            raise EventValidationError("Event date and time must be in the future.")

    def create(
        self,
        user: UserAccount,
        *,
        title: str,
        description: str | None,
        event_date: date,
        event_time: time | None,
        send_email: bool = False,
    ) -> tuple[CalendarEventModel, bool]:
        self._validate_schedule(event_date, event_time)
        event = self._repository.create(
            user_id=user.id,
            title=title,
            description=description,
            event_date=event_date,
            event_time=event_time,
        )
        self._commit()
        if not send_email or self._mailer is None:
            return event, False
        try:
            self._mailer.send_confirmation(to_email=user.email, event=event)
        except EventMailError:
            logger.warning("Event scheduled notification delivery failed")
            return event, False
        return event, True

    def list_for_user(self, user_id: UUID) -> list[CalendarEventModel]:
        return self._repository.list_for_user(user_id)

    def update(
        self, user: UserAccount, event_id: UUID, **changes: str | date | time | None,
    ) -> CalendarEventModel:
        event = self._repository.get_owned(user.id, event_id)
        if event is None:
            raise EventNotFoundError("Event not found.")
        event_date = changes.get("event_date", event.event_date)
        event_time = changes.get("event_time", event.event_time)
        assert isinstance(event_date, date)
        assert event_time is None or isinstance(event_time, time)
        self._validate_schedule(event_date, event_time)
        self._repository.update(event, **changes)
        self._commit()
        return event

    def confirm(self, user: UserAccount, event_id: UUID) -> tuple[CalendarEventModel, bool]:
        event = self._repository.complete_if_pending(user.id, event_id)
        if event is None:
            existing = self._repository.get_owned(user.id, event_id)
            if existing is None:
                raise EventNotFoundError("Event not found.")
            if existing.cancelled:
                raise EventConflictError("Cancelled events cannot be confirmed.")
            return existing, existing.confirmation_email_sent

        # A failed commit must prevent any email. The durable completed flag also
        # prevents concurrent requests/retries from sending the same mail twice.
        self._commit()
        if self._mailer is None:
            return event, False
        try:
            self._mailer.send_confirmation(to_email=user.email, event=event)
        except EventMailError:
            logger.warning("Event confirmation delivery failed")
            return event, False

        self._repository.mark_email_sent(event)
        self._commit()
        return event, True

    def cancel(self, user: UserAccount, event_id: UUID) -> CalendarEventModel:
        event = self._repository.cancel_owned(user.id, event_id)
        if event is None:
            event = self._repository.get_owned(user.id, event_id)
            if event is None:
                raise EventNotFoundError("Event not found.")
            return event
        self._commit()
        return event

    def delete(self, user: UserAccount, event_id: UUID) -> None:
        if not self._repository.delete_owned(user.id, event_id):
            raise EventNotFoundError("Event not found.")
        self._commit()
