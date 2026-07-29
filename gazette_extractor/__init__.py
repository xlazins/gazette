"""Moroccan BOAL company-notice extraction."""

from .parser import GazetteNoticeParser
from .pdf_issue import PypdfIssueExtractor

__all__ = ["GazetteNoticeParser", "PypdfIssueExtractor"]
__version__ = "0.1.0"
