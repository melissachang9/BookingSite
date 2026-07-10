import asyncio
from app.db.session import get_session_maker
from app.db.models import (
    FormDefinition, FormVersion, FormResponse, ServiceFormAttachment,
    BookingDraftFormRequirement, BookingDraftIntakePlan,
    Provider, ProviderLocation, ProviderService, ProviderSchedule, ProviderTimeOff,
    User, Booking, BookingDraft, Payment, Customer, SlotHold
)
from sqlalchemy import select, delete

async def main():
    async with get_session_maker()() as session:
        forms = (await session.scalars(select(FormDefinition))).all()
        providers = (await session.scalars(select(Provider))).all()
        users = (await session.scalars(select(User))).all()
        customers = (await session.scalars(select(Customer))).all()
        bookings = (await session.scalars(select(Booking))).all()
        drafts = (await session.scalars(select(BookingDraft))).all()
        payments = (await session.scalars(select(Payment))).all()
        print(f"Before: {len(forms)} forms, {len(providers)} providers, {len(users)} users, {len(customers)} customers, {len(bookings)} bookings, {len(drafts)} drafts, {len(payments)} payments")
        
        await session.execute(delete(BookingDraftFormRequirement))
        await session.execute(delete(BookingDraftIntakePlan))
        await session.execute(delete(FormResponse))
        await session.execute(delete(ServiceFormAttachment))
        await session.execute(delete(FormVersion))
        await session.execute(delete(FormDefinition))
        await session.execute(delete(Payment))
        await session.execute(delete(SlotHold))
        await session.execute(delete(BookingDraft))
        await session.execute(delete(Booking))
        await session.execute(delete(ProviderSchedule))
        await session.execute(delete(ProviderTimeOff))
        await session.execute(delete(ProviderService))
        await session.execute(delete(ProviderLocation))
        await session.execute(delete(Provider))
        await session.execute(delete(Customer))
        await session.execute(delete(User).where(User.role != "owner"))
        await session.commit()
        
        forms2 = (await session.scalars(select(FormDefinition))).all()
        providers2 = (await session.scalars(select(Provider))).all()
        users2 = (await session.scalars(select(User))).all()
        customers2 = (await session.scalars(select(Customer))).all()
        bookings2 = (await session.scalars(select(Booking))).all()
        print(f"After: {len(forms2)} forms, {len(providers2)} providers, {len(users2)} users, {len(customers2)} customers, {len(bookings2)} bookings")
        print("Database cleaned. Owner account preserved.")

asyncio.run(main())
