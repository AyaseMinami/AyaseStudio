#[path = "../update_signature.rs"]
mod update_signature;

fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let result = (|| -> Result<(), String> {
        if args.len() != 4 { return Err("Usage: verify-updater-signature <public-key> <installer> <sig> <version>".into()); }
        let bytes = std::fs::read(&args[1]).map_err(|_| "Cannot read candidate installer")?;
        let signature = std::fs::read_to_string(&args[2]).map_err(|_| "Cannot read candidate signature")?;
        update_signature::validate_public_key(&args[0])?;
        update_signature::verify_release(&bytes, &args[0], &signature, &args[3])
    })();
    if let Err(error) = result { eprintln!("{error}"); std::process::exit(1); }
    println!("Updater signature verified.");
}
