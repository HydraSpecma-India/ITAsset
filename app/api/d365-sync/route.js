import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req) {
  try {
    const body = await req.json();
    const { erpUrl, username, password, syncMode, manualItems, targetDept } = body;

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "https://ollhtyeflpggdazrsqsq.supabase.co";
    const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "sb_publishable_vXtlD6VqEY8u_tBSdmw-0A_hxEIlf2j";
    const supabase = createClient(supabaseUrl, supabaseKey);

    let fixedAssets = [];

    if (syncMode === "manual" && Array.isArray(manualItems)) {
      fixedAssets = manualItems;
    } else {
      // 1. Fetch D365FO FixedAssets OData endpoint
      const targetUrl = erpUrl || "https://hydraspecma-prod.operations.dynamics.com/data/FixedAssets";
      
      const headers = {
        "Accept": "application/json",
        "Content-Type": "application/json",
      };

      if (username && password) {
        const authHeader = "Basic " + Buffer.from(`${username}:${password}`).toString("base64");
        headers["Authorization"] = authHeader;
      }

      const res = await fetch(targetUrl, {
        method: "GET",
        headers,
        cache: "no-store",
      });

      if (!res.ok) {
        const errText = await res.text();
        return NextResponse.json(
          { error: `D365FO Endpoint responded with status ${res.status}: ${errText.slice(0, 300)}` },
          { status: 400 }
        );
      }

      const data = await res.json();
      fixedAssets = data.value || data.value || [];
    }

    if (!fixedAssets.length) {
      return NextResponse.json({ message: "No fixed assets retrieved from D365FO.", updatedCount: 0 });
    }

    // 2. Fetch existing assets in Supabase
    let assetQuery = supabase.from("it_assets").select("id, asset_name, asset_tag, serial_no, asset_no, asset_group_id, budget_department");
    if (targetDept && targetDept !== "All") {
      if (targetDept === "IT") {
        assetQuery = assetQuery.or("budget_department.eq.IT,budget_department.is.null");
      } else {
        assetQuery = assetQuery.eq("budget_department", targetDept);
      }
    }

    const { data: dbAssets, error: dbErr } = await assetQuery;
    if (dbErr) {
      return NextResponse.json({ error: "Failed to fetch assets from database: " + dbErr.message }, { status: 500 });
    }

    let updatedCount = 0;
    let matchedDetails = [];

    // Map existing assets for quick lookup by serial_no, asset_tag, asset_name
    const serialMap = new Map();
    const tagMap = new Map();
    const nameMap = new Map();

    (dbAssets || []).forEach((item) => {
      if (item.serial_no) serialMap.set(item.serial_no.trim().toLowerCase(), item);
      if (item.asset_tag) tagMap.set(item.asset_tag.trim().toLowerCase(), item);
      if (item.asset_name) nameMap.set(item.asset_name.trim().toLowerCase(), item);
    });

    for (const fa of fixedAssets) {
      const faNo = fa.FixedAssetNumber || fa.fixed_asset_number || fa.AssetNo || fa.asset_no;
      const faGroup = fa.FixedAssetGroupId || fa.fixed_asset_group_id || fa.AssetGroup || fa.asset_group_id;
      const faSerial = fa.SerialNumber || fa.serial_number || fa.SerialNo;
      const faTag = fa.Barcode || fa.barcode || fa.AssetTag || fa.asset_tag;
      const faName = fa.Name || fa.name || fa.Description || fa.description;

      if (!faNo) continue;

      let matchedAsset = null;
      if (faSerial && serialMap.has(faSerial.trim().toLowerCase())) {
        matchedAsset = serialMap.get(faSerial.trim().toLowerCase());
      } else if (faTag && tagMap.has(faTag.trim().toLowerCase())) {
        matchedAsset = tagMap.get(faTag.trim().toLowerCase());
      } else if (faName && nameMap.has(faName.trim().toLowerCase())) {
        matchedAsset = nameMap.get(faName.trim().toLowerCase());
      }

      if (matchedAsset) {
        const { error: updateErr } = await supabase
          .from("it_assets")
          .update({
            asset_no: faNo,
            asset_group_id: faGroup || matchedAsset.asset_group_id,
          })
          .eq("id", matchedAsset.id);

        if (!updateErr) {
          updatedCount++;
          matchedDetails.push({
            asset_id: matchedAsset.id,
            asset_name: matchedAsset.asset_name,
            asset_no: faNo,
            group_id: faGroup || "—",
          });
        }
      }
    }

    return NextResponse.json({
      success: true,
      totalErpFetched: fixedAssets.length,
      updatedCount,
      matchedDetails,
    });
  } catch (err) {
    return NextResponse.json({ error: "Sync failed: " + (err.message || String(err)) }, { status: 500 });
  }
}
