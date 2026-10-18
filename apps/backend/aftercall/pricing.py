"""Prices and display currency. Billing is off, so there are no prices and no discounts; what's left
is the currency the web shows amounts in (US dollars are the base: every amount sent is USD).
"""

from typing import Any

from fastapi import Request

from aftercall.config import get_settings
from aftercall.models import Tenant
from aftercall.store import Store

COUNTRY_HEADERS = ("cf-ipcountry", "cloudfront-viewer-country", "x-country")
COUNTRY_CURRENCY = {"US": "USD", "IN": "INR", "GB": "GBP", "AE": "AED", "SG": "SGD", "DE": "EUR", "FR": "EUR",
                    "ES": "EUR", "IT": "EUR", "NL": "EUR", "IE": "EUR", "PT": "EUR", "BE": "EUR", "AT": "EUR", "FI": "EUR"}
CURRENCY_COUNTRY = {"USD": "US", "INR": "IN", "GBP": "GB", "AED": "AE", "SGD": "SG", "EUR": "DE"}


def current(store: Store | None = None) -> dict[str, Any]:
    """The prices in force: none."""
    return {
        "payg_per_million": None, "pro_monthly_fee": None, "pro_per_million": None, "pro_included_tokens": 0,
        "trial_credit_usd": 0.0, "min_top_up_usd": 0.0, "regions": [], "updated_at": None, "updated_by": None,
    }


def region(config: dict[str, Any], country: str | None) -> dict[str, Any] | None:
    return next((r for r in config["regions"] if r["country"] == country), None)


def country_of(request: Request) -> str | None:
    value = next((request.headers[h] for h in COUNTRY_HEADERS if request.headers.get(h)), None)
    return value.upper()[:2] if value and value.upper() not in ("XX", "T1") else None


def display_currency(request: Request, tenant: Tenant | None = None, store: Store | None = None) -> dict[str, Any]:
    rates = get_settings().fx_rates
    if tenant is not None and tenant.currency in rates:
        return {"code": tenant.currency, "rate": rates[tenant.currency],
                "country": CURRENCY_COUNTRY.get(tenant.currency), "source": "workspace"}
    country = country_of(request)
    code = COUNTRY_CURRENCY.get(country or "", "USD")
    if code not in rates:
        return {"code": "USD", "rate": 1.0, "country": country, "source": "default"}
    return {"code": code, "rate": rates[code], "country": country, "source": "geo" if country else "default"}


def promotion(store: Store, country: str | None) -> None:
    """No promotions while billing is off."""
    return None


def promotion_out(promo: None) -> None:
    return None
