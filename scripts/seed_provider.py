import asyncio
from app.db.session import get_session_maker
from app.db.models import User, Provider, ProviderLocation, ProviderService, ProviderSchedule, Service, Location
from sqlalchemy import select
import datetime

async def main():
    async with get_session_maker()() as session:
        # Get the owner user
        owner = (await session.scalars(select(User).where(User.email == "owner@browbeautylab.test"))).first()
        if not owner:
            print("Owner not found!")
            return
        
        # Get locations
        locations = (await session.scalars(select(Location))).all()
        services = (await session.scalars(select(Service))).all()
        print(f"Locations: {[l.name for l in locations]}")
        print(f"Services: {[s.name for s in services]}")
        
        # Create a provider
        provider = Provider(
            tenant_id=owner.tenant_id,
            user_id=owner.id,
            name="Melissa Chang",
            email=owner.email,
            is_active=True,
            is_bookable_online=True,
        )
        session.add(provider)
        await session.flush()
        
        # Assign to both locations
        for loc in locations:
            session.add(ProviderLocation(tenant_id=owner.tenant_id, provider_id=provider.id, location_id=loc.id))
        
        # Assign to all services
        for svc in services:
            session.add(ProviderService(tenant_id=owner.tenant_id, provider_id=provider.id, service_id=svc.id))
        
        # Set work hours: Mon-Fri 9-5 for both locations
        for loc in locations:
            for weekday in range(0, 5):  # Mon-Fri
                session.add(ProviderSchedule(
                    tenant_id=owner.tenant_id,
                    provider_id=provider.id,
                    location_id=loc.id,
                    weekday=weekday,
                    start_time=datetime.time(9, 0),
                    end_time=datetime.time(17, 0),
                    is_active=True,
                ))
        
        await session.commit()
        print(f"Provider created: {provider.name} (id={provider.id})")
        print("Assigned to all locations and services with Mon-Fri 9-5 schedule")

asyncio.run(main())
