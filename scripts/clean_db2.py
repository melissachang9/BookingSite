import asyncio
from app.db.session import get_session_maker
from app.db.models import (
    FormDefinition, FormVersion, FormResponse, ServiceFormAttachment,
    BookingDraftFormRequirement, BookingDraftIntakePlan,
    Provider, ProviderLocation, ProviderService, ProviderSchedule, ProviderTimeOff,
    User, Booking, BookingDraft, Payment, Customer, SlotHold, BookingPaymentEvent
)
from sqlalchemy import select, delete

async def main():
    async with get_session_maker()() as session:
        forms = (await session.scalars(select(FormDefinition))).all()
        providers = (await session.scalars(select(Provider))).all()
        users = (await session.scalars(select(User))).all()
        print(f"Before: {len(forms)} forms, {len(providers)} providers, {len(users)} users")
        
        # Delete in correct dependency order
        await session.execute(delete(BookingDraftFormRequirement))
        await session.execute(delete(BookingDraftIntakePlan))
        await session.execute(delete(FormResponse))
        await session.execute(delete(ServiceFormAttachment))
        await session.execute(delete(FormVersion))
        await session.execute(delete(FormDefinition))
        await session.execute(delete(BookingPaymentEvent))
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
        print(f"After: {len(forms2)} forms, {len(providers2)} providers, {len(users2)} users")
        print("Done.")

asyncio.run(main())
